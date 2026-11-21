import PDFDocument from "pdfkit";
import path from "node:path";
import type { Course } from "@shared/schema";
import { type Block, courseMeta, letter } from "./blocks";

const C = {
  violet: "#7D4FFE",
  lilac: "#C49FFF",
  rose: "#FE277E",
  bordeaux: "#8A0D1E",
  ink: "#1A1033",
  text: "#2B2440",
  muted: "#6B6680",
  line: "#E6E1F5",
  soft: "#F5F1FF",
  roseSoft: "#FFF0F6",
};

const FONT_DIR = path.resolve("server/fonts");

// Caractères absents de la police : remplacés par un équivalent lisible.
const SUBST: [RegExp, string][] = [
  [/⇒/g, "→"],
  [/[✓✔]/g, "✔"],
  [/\u00a0|\u202f/g, " "],
];
function sanitize<T>(v: T): T {
  if (typeof v === "string") return SUBST.reduce((s, [r, x]) => s.replace(r, x), v as string).replace(/✔/g, "") as T;
  if (Array.isArray(v)) return v.map(sanitize) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitize(x)])) as T;
  return v;
}

export function renderPdf(course: Course, rawBlocks: Block[]): Promise<Buffer> {
  const c = sanitize(course);
  const blocks = sanitize(rawBlocks);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 64, bottom: 64, left: 56, right: 56 },
      bufferPages: true,
      info: { Title: c.title, Author: c.ownerName || "CoursScribe", Creator: "CoursScribe" },
    });
    doc.registerFont("R", path.join(FONT_DIR, "Lato-Regular.ttf"));
    doc.registerFont("B", path.join(FONT_DIR, "Lato-Bold.ttf"));
    doc.registerFont("I", path.join(FONT_DIR, "Lato-Italic.ttf"));
    doc.registerFont("X", path.join(FONT_DIR, "Lato-Black.ttf"));
    const chunks: Buffer[] = [];
    doc.on("data", (d) => chunks.push(d));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const ensure = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };
    const textH = (t: string, font: string, size: number, width = W, opts: any = {}) => {
      doc.font(font).fontSize(size);
      return doc.heightOfString(t, { width, lineGap: 3, ...opts });
    };

    // ---- Couverture ----
    doc.rect(0, 0, doc.page.width, 250).fill(C.ink);
    doc.circle(doc.page.width - 40, 30, 150).fillOpacity(0.25).fill(C.violet).fillOpacity(1);
    doc.circle(doc.page.width - 120, 230, 70).fillOpacity(0.18).fill(C.rose).fillOpacity(1);
    doc.roundedRect(L, 56, 30, 30, 8).fill(C.violet);
    doc.font("B").fontSize(13).fillColor("#FFFFFF").text("CoursScribe", L + 40, 63);
    const meta = courseMeta(c);
    doc.font("B").fontSize(9).fillColor(C.lilac).text(meta.toUpperCase(), L, 128, { width: W, characterSpacing: 1.2 });
    doc.font("X").fontSize(26).fillColor("#FFFFFF").text(c.title, L, 146, { width: W - 40, lineGap: 2 });
    doc.y = 290;
    doc.x = L;

    const drawBlock = (b: Block) => {
      switch (b.t) {
        case "part": {
          if (doc.y > 300) doc.addPage();
          else doc.moveDown(0.6);
          ensure(70);
          const y = doc.y;
          doc.rect(L, y, 4, 40).fill(C.violet);
          doc.font("B").fontSize(9).fillColor(C.violet).text((b.kicker || "").toUpperCase(), L + 14, y + 2, { characterSpacing: 1.4 });
          doc.font("X").fontSize(21).fillColor(C.ink).text(b.text, L + 14, y + 14, { width: W - 14 });
          doc.x = L;
          doc.moveDown(0.8);
          break;
        }
        case "h2": {
          ensure(90);
          doc.moveDown(0.6);
          doc.font("B").fontSize(13.5).fillColor(C.ink).text(b.text, L, doc.y, { width: W });
          const y = doc.y + 3;
          doc.moveTo(L, y).lineTo(L + 36, y).lineWidth(2).strokeColor(C.rose).stroke();
          doc.y = y + 8;
          break;
        }
        case "h3": {
          ensure(75);
          doc.moveDown(0.3);
          doc.font("B").fontSize(11.5).fillColor(C.violet).text(b.text, L, doc.y, { width: W });
          doc.moveDown(0.25);
          break;
        }
        case "p": {
          const h = textH(b.text, b.muted ? "R" : "R", 10.5);
          ensure(Math.min(h, 60));
          doc.font("R").fontSize(10.5).fillColor(b.muted ? C.muted : C.text).text(b.text, L, doc.y, { width: W, lineGap: 3, align: "left" });
          doc.moveDown(0.5);
          break;
        }
        case "callout": {
          const pad = 14;
          const dark = b.tone === "dark";
          const bg = dark ? C.ink : b.tone === "rose" ? C.roseSoft : C.soft;
          const bodyFont = dark ? "B" : "R";
          const bodySize = dark ? 12.5 : 10.5;
          const hl = textH(b.label.toUpperCase(), "B", 8.5, W - pad * 2);
          const hb = textH(b.text, bodyFont, bodySize, W - pad * 2);
          const h = hl + hb + pad * 2 + 6;
          ensure(h + 6);
          const y = doc.y;
          doc.roundedRect(L, y, W, h, 10).fill(bg);
          if (!dark) doc.rect(L, y + 10, 3, h - 20).fill(b.tone === "rose" ? C.rose : C.violet);
          doc.font("B").fontSize(8.5).fillColor(dark ? C.lilac : b.tone === "rose" ? C.bordeaux : C.violet)
            .text(b.label.toUpperCase(), L + pad, y + pad, { width: W - pad * 2, characterSpacing: 1.2 });
          doc.font(bodyFont).fontSize(bodySize).fillColor(dark ? "#FFFFFF" : C.text)
            .text(b.text, L + pad, y + pad + hl + 6, { width: W - pad * 2, lineGap: 3 });
          doc.x = L;
          doc.y = y + h + 10;
          break;
        }
        case "tags": {
          ensure(30);
          let x = L;
          let y = doc.y;
          doc.font("R").fontSize(8.5);
          for (const t of b.items) {
            const w = doc.widthOfString(t) + 16;
            if (x + w > L + W) {
              x = L;
              y += 20;
            }
            doc.roundedRect(x, y, w, 16, 8).fill(C.soft);
            doc.fillColor(C.violet).text(t, x + 8, y + 3.5, { lineBreak: false });
            x += w + 6;
          }
          doc.x = L;
          doc.y = y + 26;
          break;
        }
        case "bullets":
        case "numbered": {
          b.items.forEach((it, i) => {
            const h = textH(it, "R", 10.5, W - 22);
            ensure(h + 4);
            const y = doc.y;
            if (b.t === "numbered") {
              doc.roundedRect(L, y + 1, 15, 15, 4).fill(C.violet);
              doc.font("B").fontSize(8).fillColor("#FFFFFF").text(String(i + 1), L, y + 4.5, { width: 15, align: "center" });
            } else if (!it.startsWith("☐")) {
              doc.circle(L + 5, y + 7.5, 2.4).fill(C.rose);
            }
            const txt = it.startsWith("☐") ? it.replace(/^☐\s*/, "") : it;
            if (it.startsWith("☐")) doc.roundedRect(L, y + 2, 11, 11, 2).lineWidth(1).strokeColor(C.violet).stroke();
            doc.font("R").fontSize(10.5).fillColor(C.text).text(txt, L + 22, y, { width: W - 22, lineGap: 3 });
            doc.y = Math.max(doc.y, y + 16) + 3;
          });
          doc.x = L;
          doc.moveDown(0.3);
          break;
        }
        case "def": {
          const hT = textH(b.term, "B", 10.5);
          const hD = textH(b.text, "R", 10.5, W - 12);
          ensure(hT + hD + 12);
          const y = doc.y;
          doc.font("B").fontSize(10.5).fillColor(C.ink).text(b.term, L + 12, y, { width: W - 12 });
          doc.font("R").fontSize(10.5).fillColor(C.text).text(b.text, L + 12, doc.y + 1, { width: W - 12, lineGap: 3 });
          doc.rect(L, y + 2, 2.5, doc.y - y - 2).fill(C.lilac);
          doc.x = L;
          doc.y += 8;
          break;
        }
        case "formula": {
          const pad = 12;
          const hl = textH(b.label, "B", 9);
          const he = textH(b.expr, "B", 12.5, W - pad * 2);
          const hm = b.meaning ? textH(b.meaning, "R", 9.5, W - pad * 2) : 0;
          const h = hl + he + hm + pad * 2 + 8;
          ensure(h + 6);
          const y = doc.y;
          doc.roundedRect(L, y, W, h, 8).lineWidth(1).strokeColor(C.line).stroke();
          doc.font("B").fontSize(9).fillColor(C.muted).text(b.label, L + pad, y + pad, { width: W - pad * 2 });
          doc.font("B").fontSize(12.5).fillColor(C.violet).text(b.expr, L + pad, doc.y + 3, { width: W - pad * 2 });
          if (b.meaning) doc.font("R").fontSize(9.5).fillColor(C.muted).text(b.meaning, L + pad, doc.y + 3, { width: W - pad * 2, lineGap: 2 });
          doc.x = L;
          doc.y = y + h + 8;
          break;
        }
        case "qa": {
          const hq = textH(b.q, "B", 10.5, W - 16);
          const ha = textH(b.a, "R", 10.5, W - 16);
          ensure(hq + ha + 14);
          doc.font("B").fontSize(10.5).fillColor(C.ink).text(b.q, L + 16, doc.y, { width: W - 16, lineGap: 2 });
          doc.font("B").fontSize(10.5).fillColor(C.rose).text("Q", L, doc.y - hq, { width: 12 });
          doc.font("R").fontSize(10.5).fillColor(C.text).text(b.a, L + 16, doc.y + 2, { width: W - 16, lineGap: 3 });
          doc.x = L;
          doc.y += 9;
          break;
        }
        case "question": {
          const hq = textH(b.text, "B", 10.5, W - 28);
          ensure(hq + 34 + (b.options?.length || 0) * 16);
          const y = doc.y;
          doc.font("B").fontSize(10).fillColor(C.lilac).text(String(b.n).padStart(2, "0"), L, y + 1, { width: 24 });
          doc.font("B").fontSize(8).fillColor(C.muted).text(b.meta.toUpperCase(), L + 28, y, { width: W - 28, characterSpacing: 0.8 });
          doc.font("B").fontSize(10.5).fillColor(C.ink).text(b.text, L + 28, doc.y + 2, { width: W - 28, lineGap: 3 });
          if (b.options?.length) {
            doc.moveDown(0.2);
            b.options.forEach((o, i) => {
              const oy = doc.y;
              doc.font("B").fontSize(9.5).fillColor(C.violet).text(letter(i), L + 34, oy, { width: 14 });
              doc.font("R").fontSize(10).fillColor(C.text).text(o, L + 50, oy, { width: W - 50, lineGap: 2 });
              doc.y += 2;
            });
          }
          doc.x = L;
          doc.y += 10;
          break;
        }
        case "answer": {
          const af = b.text.length > 140 ? "R" : "B";
          const ht = textH(b.text, af, 10, W - 28);
          const he = b.explanation ? textH(b.explanation, "R", 9.5, W - 28) : 0;
          ensure(ht + he + 10);
          const y = doc.y;
          doc.font("B").fontSize(9.5).fillColor(C.rose).text(String(b.n).padStart(2, "0"), L, y + 1, { width: 24 });
          doc.font(af).fontSize(10).fillColor(C.ink).text(b.text, L + 28, y, { width: W - 28, lineGap: 2 });
          if (b.explanation) doc.font("R").fontSize(9.5).fillColor(C.muted).text(b.explanation, L + 28, doc.y + 1, { width: W - 28, lineGap: 2 });
          doc.x = L;
          doc.y += 8;
          break;
        }
      }
    };

    blocks.forEach(drawBlock);

    // ---- Pied de page ----
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - 40;
      doc.page.margins.bottom = 0;
      if (i > 0) {
        doc.moveTo(L, y - 8).lineTo(L + W, y - 8).lineWidth(0.6).strokeColor(C.line).stroke();
        doc.font("R").fontSize(8).fillColor(C.muted).text(`${c.title} · CoursScribe`, L, y, { width: W - 60, lineBreak: false, ellipsis: true });
      }
      doc.font("B").fontSize(8).fillColor(i > 0 ? C.muted : C.lilac).text(`${i + 1} / ${range.count}`, L + W - 60, y, { width: 60, align: "right", lineBreak: false });
    }
    doc.end();
  });
}
