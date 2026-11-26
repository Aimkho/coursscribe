import { apiRequest } from "./queryClient";

/**
 * Import d'un support de cours (PDF, Word, PowerPoint, photo) :
 * le texte est extrait dans le navigateur ; les pages scannées sont lues par l'IA.
 */
export type DocProgress = { step: string; done: number; total: number };

export const DOC_ACCEPT =
  ".pdf,.docx,.pptx,.odt,.txt,.md,.jpg,.jpeg,.png,.webp,.heic,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/*";

const MAX_BYTES = 80 * 1024 * 1024;
const OCR_BATCH = 3; // pages par requête (corps < 4 Mo)

export function docKind(file: File): "pdf" | "docx" | "pptx" | "odt" | "image" | "text" | null {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".pptx")) return "pptx";
  if (n.endsWith(".odt")) return "odt";
  if (/\.(txt|md)$/.test(n) || file.type === "text/plain") return "text";
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/.test(n)) return "image";
  return null;
}

export async function extractDocument(
  file: File,
  hint: string,
  onProgress: (p: DocProgress) => void,
  signal: { cancelled: boolean },
): Promise<{ text: string; pages: number; scanned: number }> {
  const kind = docKind(file);
  if (!kind) {
    if (/\.(doc|ppt)$/i.test(file.name)) throw new Error("Ancien format Office : enregistre le fichier en .docx / .pptx ou en PDF, puis importe-le.");
    throw new Error("Format non pris en charge : PDF, Word (.docx), PowerPoint (.pptx) ou photo.");
  }
  if (file.size > MAX_BYTES) throw new Error("Fichier trop volumineux (80 Mo maximum).");
  const check = () => {
    if (signal.cancelled) throw new Error("Import annulé.");
  };
  if (kind === "text") return { text: (await file.text()).trim(), pages: 1, scanned: 0 };
  if (kind === "docx") {
    onProgress({ step: "Lecture du document Word…", done: 0, total: 1 });
    const mammoth: any = await import("mammoth/mammoth.browser");
    const { value } = await (mammoth.default ?? mammoth).convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return { text: htmlToText(value), pages: 1, scanned: 0 };
  }
  if (kind === "pptx" || kind === "odt") return { ...(await readZipped(file, kind, onProgress)), scanned: 0 };
  if (kind === "image") {
    onProgress({ step: "Lecture de la photo par l'IA…", done: 0, total: 1 });
    const img = await loadImage(file);
    const data = canvasJpeg(drawScaled(img, img.naturalWidth, img.naturalHeight));
    const text = await ocr([data], hint);
    check();
    return { text, pages: 1, scanned: 1 };
  }
  return readPdf(file, hint, onProgress, check);
}

// ---------- PDF ----------
async function readPdf(file: File, hint: string, onProgress: (p: DocProgress) => void, check: () => void) {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  let doc: any;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (e: any) {
    if (e?.name === "PasswordException") throw new Error("Ce PDF est protégé par un mot de passe.");
    throw new Error("Ce PDF est illisible ou endommagé.");
  }
  const total = doc.numPages as number;
  const texts: string[] = new Array(total).fill("");
  const toScan: number[] = [];
  for (let i = 1; i <= total; i++) {
    check();
    onProgress({ step: "Lecture du PDF…", done: i - 1, total });
    const page = await doc.getPage(i);
    const t = pageText(await page.getTextContent());
    if (t.replace(/\s/g, "").length < 40) toScan.push(i);
    else texts[i - 1] = t;
  }
  // Pages scannées : rendues en image puis lues par l'IA, par petits lots
  for (let b = 0; b < toScan.length; b += OCR_BATCH) {
    check();
    onProgress({ step: "Lecture des pages scannées par l'IA…", done: b, total: toScan.length });
    const batch = toScan.slice(b, b + OCR_BATCH);
    const imgs: string[] = [];
    for (const n of batch) {
      const page = await doc.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1600 / Math.max(vp0.width, vp0.height));
      const vp = page.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      imgs.push(canvasJpeg(c));
    }
    const text = await ocr(imgs, hint);
    // Le texte du lot est rattaché à la première page du lot
    texts[batch[0] - 1] = text;
  }
  check();
  const text = texts
    .map((t) => t.trim())
    .filter(Boolean)
    .join("\n\n");
  return { text: stripRepeated(text), pages: total, scanned: toScan.length };
}

/** Reconstruit les lignes d'une page PDF à partir des positions des fragments de texte. */
function pageText(content: any): string {
  const items = (content.items as any[]).filter((it) => typeof it.str === "string");
  const lines: { y: number; parts: { x: number; s: string; w: number }[]; h: number }[] = [];
  for (const it of items) {
    const y = it.transform[5];
    const x = it.transform[4];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    let line = lines.find((l) => Math.abs(l.y - y) < Math.max(2, h * 0.4));
    if (!line) {
      line = { y, parts: [], h };
      lines.push(line);
    }
    line.parts.push({ x, s: it.str, w: it.width || 0 });
  }
  lines.sort((a, b) => b.y - a.y);
  const out: string[] = [];
  let prevY: number | null = null;
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    let s = "";
    let end = -Infinity;
    for (const p of l.parts) {
      const gap = p.x - end;
      if (s && gap > l.h * 1.2) s += " | ";
      else if (s && gap > l.h * 0.15 && !s.endsWith(" ") && !p.s.startsWith(" ")) s += " ";
      s += p.s;
      end = p.x + p.w;
    }
    s = s.replace(/\s+/g, " ").trim();
    if (!s) continue;
    if (prevY !== null && prevY - l.y > l.h * 1.9) out.push("");
    out.push(s);
    prevY = l.y;
  }
  // Recolle les mots coupés en fin de ligne
  return out.join("\n").replace(new RegExp("(\\p{L})-\\n(\\p{Ll})", "gu"), "$1$2");
}

/** Supprime les en-têtes / pieds de page répétés et les numéros de page isolés. */
function stripRepeated(text: string) {
  const lines = text.split("\n");
  const counts = new Map<string, number>();
  for (const l of lines) {
    const k = l.trim();
    if (k.length > 2 && k.length < 90) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const pages = Math.max(1, text.split("\n\n").length);
  return lines
    .filter((l) => {
      const k = l.trim();
      if (/^(page\s*)?\d{1,4}(\s*\/\s*\d{1,4})?$/i.test(k)) return false;
      return !((counts.get(k) || 0) >= 4 && (counts.get(k) || 0) >= pages * 0.3 && k.length < 90 && !/[|=]/.test(k));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- PowerPoint / OpenDocument ----------
async function readZipped(file: File, kind: "pptx" | "odt", onProgress: (p: DocProgress) => void) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  if (kind === "odt") {
    onProgress({ step: "Lecture du document…", done: 0, total: 1 });
    const xml = await zip.file("content.xml")?.async("string");
    if (!xml) throw new Error("Document illisible.");
    const d = new DOMParser().parseFromString(xml, "application/xml");
    const out: string[] = [];
    d.querySelectorAll("h, p, table-row").forEach((n) => {
      if (n.localName === "table-row") out.push(Array.from(n.children).map((c) => c.textContent?.trim() || "").join(" | "));
      else if (!n.closest("table-cell")) {
        const t = n.textContent?.trim();
        if (t) out.push(n.localName === "h" ? `\n${t}` : t);
      }
    });
    return { text: out.join("\n").trim(), pages: 1 };
  }
  const slides = Object.keys(zip.files)
    .map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n))
    .filter(Boolean)
    .map((m) => ({ name: m![0], n: Number(m![1]) }))
    .sort((a, b) => a.n - b.n);
  if (!slides.length) throw new Error("Aucune diapositive trouvée.");
  const out: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    onProgress({ step: "Lecture des diapositives…", done: i, total: slides.length });
    const xml = await zip.file(slides[i].name)!.async("string");
    const d = new DOMParser().parseFromString(xml, "application/xml");
    const lines: string[] = [];
    // Tableaux
    const tables = Array.from(d.getElementsByTagNameNS("*", "tbl"));
    // Paragraphes hors tableaux
    Array.from(d.getElementsByTagNameNS("*", "p")).forEach((p) => {
      if (p.namespaceURI?.includes("drawingml") && !tables.some((t) => t.contains(p))) {
        const t = Array.from(p.getElementsByTagNameNS("*", "t"))
          .map((x) => x.textContent || "")
          .join("")
          .trim();
        if (t) lines.push(t);
      }
    });
    for (const t of tables) {
      Array.from(t.getElementsByTagNameNS("*", "tr")).forEach((tr) => {
        lines.push(
          Array.from(tr.getElementsByTagNameNS("*", "tc"))
            .map((tc) => (tc.textContent || "").replace(/\s+/g, " ").trim())
            .join(" | "),
        );
      });
    }
    // Notes de l'orateur
    const notes = await zip.file(`ppt/notesSlides/notesSlide${slides[i].n}.xml`)?.async("string");
    let noteText = "";
    if (notes) {
      const nd = new DOMParser().parseFromString(notes, "application/xml");
      noteText = Array.from(nd.getElementsByTagNameNS("*", "p"))
        .map((p) => Array.from(p.getElementsByTagNameNS("*", "t")).map((x) => x.textContent || "").join("").trim())
        .filter((t) => t && !/^\d+$/.test(t))
        .join("\n");
    }
    if (lines.length || noteText) out.push(`Diapositive ${i + 1}\n${lines.join("\n")}${noteText ? `\nNotes : ${noteText}` : ""}`);
  }
  return { text: out.join("\n\n").trim(), pages: slides.length };
}

// ---------- Word (HTML de mammoth -> texte structuré) ----------
function htmlToText(html: string) {
  const d = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const out: string[] = [];
  const walk = (el: Element) => {
    for (const n of Array.from(el.children)) {
      const tag = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) out.push("", (n.textContent || "").trim());
      else if (tag === "p") {
        const t = (n.textContent || "").trim();
        if (t) out.push(t);
      } else if (tag === "ul" || tag === "ol") {
        let k = 1;
        for (const li of Array.from(n.children)) {
          const sub = Array.from(li.children).filter((c) => /^(ul|ol)$/i.test(c.tagName));
          const own = Array.from(li.childNodes)
            .filter((c) => !(c instanceof Element && /^(ul|ol)$/i.test(c.tagName)))
            .map((c) => c.textContent || "")
            .join("")
            .trim();
          if (own) out.push(`${tag === "ol" ? `${k++}.` : "-"} ${own}`);
          sub.forEach((s) => walk({ children: [s] } as unknown as Element));
        }
      } else if (tag === "table") {
        out.push("");
        n.querySelectorAll("tr").forEach((tr) =>
          out.push(
            Array.from(tr.children)
              .map((c) => (c.textContent || "").replace(/\s+/g, " ").trim())
              .join(" | "),
          ),
        );
        out.push("");
      } else walk(n);
    }
  };
  walk(d.body.firstElementChild!);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- Images ----------
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image illisible : utilise une photo JPEG ou PNG."));
    img.src = url;
  });
}
function drawScaled(img: CanvasImageSource, w: number, h: number) {
  const scale = Math.min(1, 1800 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
function canvasJpeg(c: HTMLCanvasElement) {
  return c.toDataURL("image/jpeg", 0.72).split(",")[1];
}

async function ocr(images: string[], hint: string) {
  const r = await apiRequest("POST", "/api/document/ocr", { pages: images.map((data) => ({ mime: "image/jpeg", data })), hint });
  const j = await r.json();
  return String(j.text || "");
}
