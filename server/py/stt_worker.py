"""Worker de transcription (speech-to-text) pour CoursScribe.

Protocole : une requête JSON par ligne sur stdin
  {"id": "...", "b64": "<audio base64>", "mime": "audio/webm", "context": "fin du texte précédent"}
Réponse JSON par ligne sur stdout :
  {"id": "...", "text": "..."}  ou  {"id": "...", "error": "..."}
"""
import asyncio, json, sys
from pplx.python.sdks.llm_api import (
    AudioBlock, AudioSource, Client, ContentBlockType, Conversation, Identity,
    LLMAPIClient, SamplingParams, TextBlock,
)

MODEL = "gemini_3_flash"
SYSTEM = (
    "Tu es un transcripteur professionnel. Tu reçois un court extrait audio enregistré pendant un cours, en français. "
    "Transcris fidèlement ce qui est dit, en français, avec une ponctuation correcte. "
    "Ne traduis pas, ne résume pas, ne commente pas, n'ajoute aucun titre ni guillemets. "
    "N'invente jamais rien : transcris uniquement les paroles réellement audibles dans cet extrait. "
    "Le texte de contexte éventuel sert seulement à orthographier les termes techniques ; ne le continue pas et ne le répète pas. "
    "Si un mot est coupé au début ou à la fin de l'extrait, ignore-le. "
    "Si l'extrait ne contient aucune parole intelligible (silence, bruit, musique), réponds exactement : [silence]"
)

client = None
lock = asyncio.Lock()

def write(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

async def handle(req):
    global client
    try:
        if client is None:
            client = LLMAPIClient()
        convo = Conversation()
        convo.set_system(SYSTEM)
        ctx = (req.get("context") or "").strip()
        instruction = "Transcris cet extrait."
        if ctx:
            instruction += f" Vocabulaire du cours (pour l'orthographe uniquement) : {ctx[-200:]}"
        convo.add_user([
            AudioBlock(type=ContentBlockType.AUDIO, source=AudioSource(media_type=req.get("mime") or "audio/webm", data=req["b64"])),
            TextBlock(type=ContentBlockType.TEXT, text=instruction),
        ])
        r = await client.messages.create(
            model=MODEL, convo=convo,
            identity=Identity(client=Client.ASI, use_case="webserver_audio_gen"),
            sampling_params=SamplingParams(max_tokens=1500),
        )
        text = "".join(getattr(b, "text", "") or "" for b in r.content).strip()
        if text.strip("[]. ").lower() == "silence":
            text = ""
        write({"id": req["id"], "text": text})
    except Exception as e:  # noqa: BLE001
        write({"id": req.get("id"), "error": str(e)[:300]})

async def main():
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(limit=64 * 1024 * 1024)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    write({"ready": True})
    while True:
        line = await reader.readline()
        if not line:
            break
        try:
            req = json.loads(line)
        except Exception:
            continue
        asyncio.create_task(handle(req))

asyncio.run(main())
