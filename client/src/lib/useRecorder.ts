import { useCallback, useEffect, useRef, useState } from "react";

export type RecState = "idle" | "starting" | "recording" | "paused" | "stopped";
export type SttStatus = "idle" | "ok" | "busy" | "error";
export type PauseReason = "manual" | "inactivity" | null;

const INACTIVITY_MS = 5 * 60 * 1000;
// Découpage de l'audio en extraits envoyés à la transcription IA.
const SEG_MIN_MS = 8000; // on coupe sur une pause naturelle après 8 s
const SEG_MAX_MS = 16000; // coupe forcée à 16 s
const QUIET_CUT_MS = 350; // durée de silence qui marque une pause
const MIN_VOICED_MS = 500; // en dessous, l'extrait est considéré comme silencieux

type SR = any;
function getSpeechRecognition(): (new () => SR) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechSupported() {
  return !!getSpeechRecognition();
}

/**
 * Enregistrement audio + transcription en direct sur le micro réel.
 * - Une seule capture micro (getUserMedia) : enregistrement complet + extraits de ~10 s.
 * - Chaque extrait contenant de la parole est transcrit par l'IA côté serveur (fiable,
 *   tous navigateurs). Les textes sont ajoutés dans l'ordre, même si les réponses arrivent en désordre.
 * - La reconnaissance vocale du navigateur, si disponible, sert uniquement d'aperçu instantané.
 * - Pause automatique après 5 minutes sans activité sonore.
 */
export function useRecorder(
  opts: {
    lang?: string;
    onFinal?: (text: string) => void;
    transcribe?: (blob: Blob, context: string) => Promise<string>;
    getContext?: () => string;
  } = {},
) {
  const [state, setState] = useState<RecState>("idle");
  const [pauseReason, setPauseReason] = useState<PauseReason>(null);
  const [elapsed, setElapsed] = useState(0);
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [speechStatus, setSpeechStatus] = useState<"off" | "listening" | "unsupported" | "error">(
    speechSupported() ? "off" : "unsupported",
  );
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  /** "frame" : le micro est bloqué par la fenêtre intégrée (aperçu) ; "denied" : refusé par l'utilisateur. */
  const [micBlocked, setMicBlocked] = useState<null | "frame" | "denied">(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [silenceLeft, setSilenceLeft] = useState(INACTIVITY_MS);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recogRef = useRef<SR | null>(null);
  const wantSpeechRef = useRef(false);
  const restartTimesRef = useRef<number[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const tickRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const stateRef = useRef<RecState>("idle");
  const thresholdRef = useRef(0.02);
  const onFinalRef = useRef(opts.onFinal);
  onFinalRef.current = opts.onFinal;
  const transcribeRef = useRef(opts.transcribe);
  transcribeRef.current = opts.transcribe;
  const getContextRef = useRef(opts.getContext);
  getContextRef.current = opts.getContext;

  // ----- Transcription IA par extraits -----
  const [sttStatus, setSttStatus] = useState<SttStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingPreview, setPendingPreview] = useState("");
  const [preview, setPreview] = useState(""); // aperçu navigateur de l'extrait en cours
  const segRecRef = useRef<MediaRecorder | null>(null);
  const segChunksRef = useRef<Blob[]>([]);
  const segStartRef = useRef(0);
  const segVoicedRef = useRef(0);
  const lastLoudRef = useRef(0);
  const lastFrameRef = useRef(0);
  const seqRef = useRef(0);
  const nextCommitRef = useRef(0);
  const resultsRef = useRef(new Map<number, string | null>());
  const previewsRef = useRef(new Map<number, string>());
  const curPreviewRef = useRef(""); // phrases finales du navigateur depuis la dernière coupe
  const mimeRef = useRef("");
  const failStreakRef = useRef(0);

  const setS = (s: RecState) => {
    stateRef.current = s;
    setState(s);
  };

  // ----- Reconnaissance vocale -----
  const startSpeech = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setSpeechStatus("unsupported");
      return;
    }
    wantSpeechRef.current = true;
    if (recogRef.current) {
      try {
        recogRef.current.start();
      } catch {
        /* déjà démarrée */
      }
      return;
    }
    const r: SR = new Ctor();
    r.lang = opts.lang || "fr-FR";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => {
      setSpeechStatus("listening");
      setSpeechError(null);
    };
    r.onresult = (ev: any) => {
      let inter = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const t = res[0].transcript;
        if (res.isFinal) {
          const clean = t.trim();
          if (!clean) continue;
          if (transcribeRef.current) {
            curPreviewRef.current = (curPreviewRef.current + " " + clean).trim();
            setPreview(curPreviewRef.current);
          } else onFinalRef.current?.(clean);
        } else inter += t;
      }
      setInterim(inter);
      lastActivityRef.current = Date.now();
    };
    r.onerror = (ev: any) => {
      const code = ev.error;
      if (code === "no-speech" || code === "aborted") return;
      if (transcribeRef.current) {
        // L'aperçu navigateur est facultatif : la transcription IA continue.
        if (code === "not-allowed" || code === "service-not-allowed") wantSpeechRef.current = false;
        setSpeechStatus("error");
        return;
      }
      if (code === "not-allowed" || code === "service-not-allowed") {
        wantSpeechRef.current = false;
        setSpeechStatus("error");
        setSpeechError("La transcription en direct est bloquée par le navigateur. L'audio continue d'être enregistré ; tu pourras compléter le texte ensuite.");
        return;
      }
      if (code === "network") {
        setSpeechError("Le service de transcription du navigateur ne répond pas (connexion). L'audio continue d'être enregistré, nouvel essai automatique…");
        return;
      }
      if (code === "audio-capture") {
        setSpeechError("Aucun micro disponible pour la transcription.");
        return;
      }
      setSpeechError(`Transcription interrompue (${code}). Nouvel essai automatique…`);
    };
    r.onend = () => {
      setInterim("");
      if (!wantSpeechRef.current || stateRef.current !== "recording") {
        setSpeechStatus((s) => (s === "error" || s === "unsupported" ? s : "off"));
        return;
      }
      // Relance contrôlée : max 6 relances en 20 s, sinon on espace.
      const now = Date.now();
      restartTimesRef.current = restartTimesRef.current.filter((t) => now - t < 20000);
      restartTimesRef.current.push(now);
      const delay = restartTimesRef.current.length > 6 ? 5000 : 250;
      window.setTimeout(() => {
        if (!wantSpeechRef.current || stateRef.current !== "recording") return;
        try {
          r.start();
        } catch {
          /* ignore */
        }
      }, delay);
    };
    recogRef.current = r;
    try {
      r.start();
    } catch {
      /* ignore */
    }
  }, [opts.lang]);

  const stopSpeech = useCallback((abort = false) => {
    wantSpeechRef.current = false;
    const r = recogRef.current;
    if (r) {
      try {
        abort ? r.abort() : r.stop();
      } catch {
        /* ignore */
      }
    }
    setInterim("");
  }, []);


  // ----- Extraits audio -> transcription IA -----
  const commitInOrder = useCallback(() => {
    const m = resultsRef.current;
    while (m.has(nextCommitRef.current)) {
      const seq = nextCommitRef.current;
      const t = m.get(seq);
      m.delete(seq);
      previewsRef.current.delete(seq);
      if (t) onFinalRef.current?.(t);
      nextCommitRef.current++;
    }
    setPendingCount(seqRef.current - nextCommitRef.current);
    setPendingPreview(Array.from(previewsRef.current.values()).filter(Boolean).join(" "));
  }, []);

  const sendSegment = useCallback(
    async (seq: number, blob: Blob, voicedMs: number, previewText: string) => {
      previewsRef.current.set(seq, previewText);
      setPendingCount(seqRef.current - nextCommitRef.current);
      setPendingPreview(Array.from(previewsRef.current.values()).filter(Boolean).join(" "));
      const fn = transcribeRef.current;
      if (!fn || voicedMs < MIN_VOICED_MS || blob.size < 1500) {
        // Extrait silencieux : rien à transcrire (on garde l'aperçu navigateur s'il a entendu quelque chose).
        resultsRef.current.set(seq, previewText || null);
        commitInOrder();
        return;
      }
      try {
        const t = await fn(blob, getContextRef.current?.() || "");
        failStreakRef.current = 0;
        resultsRef.current.set(seq, t.trim() || previewText || null);
        setSttStatus("ok");
      } catch {
        failStreakRef.current++;
        // Repli : l'aperçu du navigateur s'il existe. L'audio complet reste enregistré.
        resultsRef.current.set(seq, previewText || null);
        setSttStatus("error");
      }
      commitInOrder();
    },
    [commitInOrder],
  );

  const startSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !transcribeRef.current) return;
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(stream, mimeRef.current ? { mimeType: mimeRef.current } : undefined);
    } catch {
      return;
    }
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      const meta = (r as any)._meta as { seq: number; voiced: number; prev: string } | undefined;
      if (!meta) return;
      sendSegment(meta.seq, new Blob(chunks, { type: r.mimeType || mimeRef.current || "audio/webm" }), meta.voiced, meta.prev);
    };
    r.start();
    segRecRef.current = r;
    segStartRef.current = Date.now();
    segVoicedRef.current = 0;
  }, [sendSegment]);

  const cutSegment = useCallback(
    (restart: boolean) => {
      const r = segRecRef.current;
      segRecRef.current = null;
      if (r) {
        const seq = seqRef.current++;
        (r as any)._meta = { seq, voiced: segVoicedRef.current, prev: curPreviewRef.current.trim() };
        curPreviewRef.current = "";
        setPreview("");
        setPendingCount(seqRef.current - nextCommitRef.current);
        try {
          if (r.state !== "inactive") r.stop();
        } catch {
          /* ignore */
        }
      }
      if (restart) startSegment();
    },
    [startSegment],
  );

  /** Attend que tous les extraits envoyés soient transcrits (max 40 s). */
  const waitForPending = useCallback(async () => {
    const t0 = Date.now();
    // laisse le temps au dernier extrait d'être finalisé par MediaRecorder
    await new Promise((r) => setTimeout(r, 150));
    while (seqRef.current > nextCommitRef.current && Date.now() - t0 < 40000) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }, []);

  // ----- Boucles (niveau sonore + chrono + inactivité) -----
  const loop = useCallback(() => {
    const an = analyserRef.current;
    if (an) {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 6));
      const now = Date.now();
      const dt = Math.min(200, now - (lastFrameRef.current || now));
      lastFrameRef.current = now;
      if (stateRef.current === "recording") {
        if (rms > thresholdRef.current) {
          lastActivityRef.current = now;
          lastLoudRef.current = now;
          segVoicedRef.current += dt;
        }
        if (segRecRef.current) {
          const dur = now - segStartRef.current;
          const quiet = now - lastLoudRef.current;
          if (dur >= SEG_MAX_MS || (dur >= SEG_MIN_MS && quiet >= QUIET_CUT_MS)) cutSegment(true);
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [cutSegment]);

  const pause = useCallback(
    (reason: PauseReason = "manual") => {
      if (stateRef.current !== "recording") return;
      const rec = recorderRef.current;
      if (rec && rec.state === "recording") rec.pause();
      cutSegment(false);
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
      stopSpeech();
      setPauseReason(reason);
      setS("paused");
    },
    [stopSpeech, cutSegment],
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      if (stateRef.current === "recording") {
        elapsedRef.current += (now - lastTickRef.current) / 1000;
        setElapsed(Math.floor(elapsedRef.current));
        const left = INACTIVITY_MS - (now - lastActivityRef.current);
        setSilenceLeft(Math.max(0, left));
        if (left <= 0) pause("inactivity");
      }
      lastTickRef.current = now;
    }, 500);
    tickRef.current = id;
    return () => window.clearInterval(id);
  }, [pause]);

  const start = useCallback(async () => {
    if (stateRef.current === "recording" || stateRef.current === "starting") return;
    setMicError(null);
    setMicBlocked(null);
    setSpeechError(null);
    setS("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        const err: any = new Error("micro indisponible dans cette fenêtre");
        err.name = "SecurityError";
        throw err;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        setAudioBlob(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start(1000);
      recorderRef.current = rec;
      mimeRef.current = rec.mimeType || mime;
      seqRef.current = 0;
      nextCommitRef.current = 0;
      resultsRef.current.clear();
      previewsRef.current.clear();
      curPreviewRef.current = "";
      failStreakRef.current = 0;
      setPreview("");
      setPendingPreview("");
      setPendingCount(0);
      setSttStatus(transcribeRef.current ? "ok" : "idle");

      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      ctxRef.current = ctx;
      analyserRef.current = an;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);

      stream.getAudioTracks()[0]?.addEventListener("ended", () => {
        setMicError("Le micro a été déconnecté. L'enregistrement a été arrêté, l'audio capturé est conservé.");
        stopRef.current?.();
      });

      elapsedRef.current = 0;
      setElapsed(0);
      lastTickRef.current = Date.now();
      lastActivityRef.current = Date.now();
      setAudioBlob(null);
      setPauseReason(null);
      setS("recording");
      lastLoudRef.current = Date.now();
      startSegment();
      startSpeech();
    } catch (e: any) {
      setS("idle");
      if (micBlockedByFrame() && (e?.name === "NotAllowedError" || e?.name === "SecurityError")) {
        setMicBlocked("frame");
        setMicError("Le micro est bloqué par la fenêtre dans laquelle l'application est affichée.");
      } else if (e?.name === "SecurityError") {
        setMicBlocked("frame");
        setMicError("Le navigateur bloque le micro sur cette page.");
      } else if (e?.name === "NotAllowedError") {
        setMicBlocked("denied");
        setMicError("Accès au micro refusé. Clique sur l'icône de cadenas dans la barre d'adresse, autorise le micro, puis réessaie.");
      }
      else if (e?.name === "NotFoundError") setMicError("Aucun micro détecté sur cet appareil.");
      else setMicError("Impossible de démarrer le micro : " + (e?.message || "erreur inconnue"));
    }
  }, [loop, startSpeech, startSegment]);

  const resume = useCallback(() => {
    if (stateRef.current !== "paused") return;
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = true));
    const rec = recorderRef.current;
    if (rec && rec.state === "paused") rec.resume();
    lastActivityRef.current = Date.now();
    lastTickRef.current = Date.now();
    restartTimesRef.current = [];
    setPauseReason(null);
    setS("recording");
    lastLoudRef.current = Date.now();
    startSegment();
    startSpeech();
  }, [startSpeech, startSegment]);

  const stop = useCallback(() => {
    if (stateRef.current === "idle" || stateRef.current === "stopped") return;
    stopSpeech(true);
    recogRef.current = null;
    cutSegment(false);
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
    setLevel(0);
    setSpeechStatus((s) => (s === "unsupported" ? s : "off"));
    setPauseReason(null);
    setS("stopped");
  }, [stopSpeech, cutSegment]);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // ----- Écran allumé pendant l'enregistrement (téléphone / tablette) -----
  // Sans cela, la mise en veille automatique de l'écran coupe le micro au bout de quelques secondes.
  useEffect(() => {
    const nav: any = navigator;
    if (state !== "recording" || !nav.wakeLock?.request) return;
    let lock: any = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState !== "visible" || cancelled) return;
        lock = await nav.wakeLock.request("screen");
      } catch {
        /* refusé (économie d'énergie) : sans effet bloquant */
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      try {
        lock?.release();
      } catch {
        /* ignore */
      }
    };
  }, [state]);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setElapsed(0);
    elapsedRef.current = 0;
    setS("idle");
  }, []);

  useEffect(
    () => () => {
      // Libère le micro si on quitte la page.
      wantSpeechRef.current = false;
      try {
        recogRef.current?.abort();
      } catch {
        /* ignore */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ctxRef.current?.close().catch(() => {});
    },
    [],
  );

  return {
    state,
    pauseReason,
    elapsed,
    interim,
    level,
    speechStatus,
    speechError,
    micError,
    micBlocked,
    audioBlob,
    silenceLeft,
    sttStatus,
    pendingCount,
    pendingPreview,
    preview,
    waitForPending,
    setThreshold: (v: number) => (thresholdRef.current = v),
    start,
    pause: () => pause("manual"),
    resume,
    stop,
    reset,
  };
}

/** Vrai si la page tourne dans une fenêtre intégrée (iframe) ou une origine isolée qui empêche l'accès au micro. */
export function micBlockedByFrame() {
  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  const opaque = window.origin === "null";
  const fp = (document as any).featurePolicy;
  const policyBlocks = fp?.allowsFeature ? !fp.allowsFeature("microphone") : false;
  return framed || opaque || policyBlocks || !window.isSecureContext;
}

export function formatDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
