import PptxGenJS from "pptxgenjs";
import type { Course } from "@shared/schema";
import { courseMeta, letter } from "./blocks";

const C = { violet: "7D4FFE", lilac: "C49FFF", rose: "FE277E", bordeaux: "8A0D1E", ink: "1A1033", text: "2B2440", muted: "6B6680", soft: "F5F1FF", roseSoft: "FFF0F6", bg: "FEFEFF", line: "E6E1F5" };
const FONT = "Calibri";
const W = 13.333;
const H = 7.5;
const M = 0.6;

const clip = (s: string | undefined, n: number) => {
  const t = (s || "").trim().replace(/\s+/g, " ");
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t;
};
const heading = (h: string) => (h || "").trim().replace(/^\d+\s*[.)\-–:]\s*/, "");
const chunk = <T,>(a: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

export async function renderPptx(c: Course): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = c.ownerName || "CoursScribe";
  pptx.title = c.title;
  pptx.company = "CoursScribe";
  const n = c.notes!;
  const s = c.sheet;
  let page = 0;

  const base = (kicker: string, title: string) => {
    page++;
    const sl = pptx.addSlide();
    sl.background = { color: C.bg };
    sl.addShape(pptx.ShapeType.rect, { x: M, y: 0.55, w: 0.08, h: 0.95, fill: { color: C.violet }, line: { color: C.violet } });
    sl.addText(kicker.toUpperCase(), { x: M + 0.25, y: 0.5, w: W - 2 * M, h: 0.35, fontFace: FONT, fontSize: 12, bold: true, color: C.violet, charSpacing: 2, margin: 0 });
    sl.addText(title, { x: M + 0.25, y: 0.85, w: W - 2 * M - 0.25, h: 0.7, fontFace: FONT, fontSize: 28, bold: true, color: C.ink, margin: 0, fit: "shrink", valign: "top" });
    sl.addText(`${clip(c.title, 70)} · CoursScribe`, { x: M, y: H - 0.5, w: 8, h: 0.3, fontFace: FONT, fontSize: 10, color: C.muted, margin: 0 });
    sl.addText(String(page), { x: W - M - 1, y: H - 0.5, w: 1, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: C.violet, align: "right", margin: 0 });
    return sl;
  };

  // 1. Couverture
  {
    page++;
    const sl = pptx.addSlide();
    sl.background = { color: C.ink };
    sl.addShape(pptx.ShapeType.ellipse, { x: 8.6, y: -2.2, w: 6.5, h: 6.5, fill: { color: C.violet, transparency: 55 }, line: { color: C.violet, transparency: 100 } });
    sl.addShape(pptx.ShapeType.ellipse, { x: 10.6, y: 4.6, w: 3.4, h: 3.4, fill: { color: C.rose, transparency: 65 }, line: { color: C.rose, transparency: 100 } });
    sl.addShape(pptx.ShapeType.roundRect, { x: M, y: 0.7, w: 0.5, h: 0.5, rectRadius: 0.12, fill: { color: C.violet }, line: { color: C.violet } });
    sl.addText("CoursScribe", { x: M + 0.65, y: 0.7, w: 4, h: 0.5, fontFace: FONT, fontSize: 18, bold: true, color: "FFFFFF", margin: 0, valign: "middle" });
    sl.addText(courseMeta(c).toUpperCase(), { x: M, y: 3.0, w: 9, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: C.lilac, charSpacing: 2, margin: 0 });
    sl.addText(c.title, { x: M, y: 3.45, w: 9.5, h: 1.9, fontFace: FONT, fontSize: 44, bold: true, color: "FFFFFF", margin: 0, valign: "top", fit: "shrink" });
    if (c.ownerName) sl.addText(`Cours enregistré par ${c.ownerName}`, { x: M, y: H - 1.0, w: 8, h: 0.4, fontFace: FONT, fontSize: 13, color: "BFB6D9", margin: 0 });
  }

  // 2. Idée centrale
  if (n.central_idea) {
    page++;
    const sl = pptx.addSlide();
    sl.background = { color: C.ink };
    sl.addText("IDÉE CENTRALE", { x: M + 0.4, y: 0.9, w: 8, h: 0.4, fontFace: FONT, fontSize: 13, bold: true, color: C.lilac, charSpacing: 3, margin: 0 });
    sl.addShape(pptx.ShapeType.rect, { x: M, y: 0.9, w: 0.08, h: 3.6, fill: { color: C.rose }, line: { color: C.rose } });
    sl.addText(clip(n.central_idea, 360), { x: M + 0.4, y: 1.45, w: W - 2 * M - 0.8, h: 3.1, fontFace: FONT, fontSize: 30, bold: true, color: "FFFFFF", margin: 0, valign: "top", fit: "shrink", paraSpaceAfter: 6 });
    const kws = (n.keywords || []).slice(0, 10);
    let x = M + 0.4;
    let y = 5.3;
    for (const k of kws) {
      const w = Math.min(4, 0.35 + k.length * 0.115);
      if (x + w > W - M) {
        x = M + 0.4;
        y += 0.55;
      }
      if (y > H - 0.8) break;
      sl.addText(k, { x, y, w, h: 0.42, shape: pptx.ShapeType.roundRect, rectRadius: 0.2, fill: { color: "2E2350" }, line: { color: "3A2D66" }, fontFace: FONT, fontSize: 12, color: "E6DEFF", align: "center", valign: "middle", margin: 0 });
      x += w + 0.15;
    }
    sl.addText(String(page), { x: W - M - 1, y: H - 0.5, w: 1, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: C.lilac, align: "right", margin: 0 });
  }

  // 3. Sommaire
  if (n.plan?.length) {
    const sl = base("Sommaire", "Le plan du cours");
    const items = n.plan.slice(0, 8);
    const half = Math.ceil(items.length / 2);
    items.forEach((p, i) => {
      const col = i < half ? 0 : 1;
      const row = col ? i - half : i;
      const x = M + 0.25 + col * 6.1;
      const y = 2.0 + row * 1.15;
      sl.addText(String(i + 1).padStart(2, "0"), { x, y, w: 0.9, h: 0.8, fontFace: FONT, fontSize: 30, bold: true, color: C.lilac, margin: 0, valign: "middle" });
      sl.addText(clip(heading(p.heading), 90), { x: x + 0.95, y, w: 4.9, h: 0.8, fontFace: FONT, fontSize: 17, bold: true, color: C.ink, margin: 0, valign: "middle", fit: "shrink" });
    });
  }

  // 4. Une ou plusieurs diapositives par partie
  (n.plan || []).forEach((p, i) => {
    const pts = (p.points || []).filter(Boolean);
    const groups = pts.length ? chunk(pts, 5) : [[]];
    groups.forEach((g, gi) => {
      const sl = base(`Partie ${i + 1}${groups.length > 1 ? ` · ${gi + 1}/${groups.length}` : ""}`, clip(heading(p.heading), 90));
      const showCard = !!p.explanation && gi === 0;
      const bw = showCard ? 7.4 : W - 2 * M - 0.25;
      if (g.length) {
        sl.addText(
          g.map((t) => ({ text: clip(t, 220), options: { bullet: { code: "25CF", indent: 22 }, color: C.text, breakLine: true, paraSpaceAfter: 10 } })),
          { x: M + 0.25, y: 1.95, w: bw, h: 4.7, fontFace: FONT, fontSize: 18, valign: "top", margin: 0, fit: "shrink", lineSpacingMultiple: 1.1 },
        );
      }
      if (showCard) {
        sl.addShape(pptx.ShapeType.roundRect, { x: 8.55, y: 1.95, w: 4.2, h: 4.7, rectRadius: 0.15, fill: { color: C.soft }, line: { color: C.soft } });
        sl.addText("EN CLAIR", { x: 8.85, y: 2.2, w: 3.6, h: 0.35, fontFace: FONT, fontSize: 11, bold: true, color: C.violet, charSpacing: 2, margin: 0 });
        sl.addText(clip(p.explanation, 520), { x: 8.85, y: 2.6, w: 3.6, h: 3.85, fontFace: FONT, fontSize: 14, color: C.text, valign: "top", margin: 0, fit: "shrink", lineSpacingMultiple: 1.1 });
      }
      if (p.explanation) sl.addNotes(p.explanation);
    });
  });

  // 5. Définitions (4 par diapositive)
  chunk(n.definitions || [], 4).forEach((g, gi, all) => {
    const sl = base("Vocabulaire", `Définitions${all.length > 1 ? ` (${gi + 1}/${all.length})` : ""}`);
    g.forEach((d, i) => {
      const x = M + 0.25 + (i % 2) * 6.15;
      const y = 1.95 + Math.floor(i / 2) * 2.4;
      sl.addShape(pptx.ShapeType.roundRect, { x, y, w: 5.95, h: 2.2, rectRadius: 0.12, fill: { color: "FFFFFF" }, line: { color: C.line, width: 1 } });
      sl.addShape(pptx.ShapeType.rect, { x: x + 0.3, y: y + 0.32, w: 0.06, h: 0.45, fill: { color: C.rose }, line: { color: C.rose } });
      sl.addText(clip(d.term, 60), { x: x + 0.5, y: y + 0.25, w: 5.2, h: 0.6, fontFace: FONT, fontSize: 18, bold: true, color: C.ink, margin: 0, valign: "middle", fit: "shrink" });
      sl.addText(clip(d.definition, 260), { x: x + 0.5, y: y + 0.9, w: 5.2, h: 1.15, fontFace: FONT, fontSize: 13, color: C.text, margin: 0, valign: "top", fit: "shrink" });
    });
  });

  // 6. Formules (3 par diapositive)
  chunk(n.formulas || [], 3).forEach((g, gi, all) => {
    const sl = base("À connaître par cœur", `Formules${all.length > 1 ? ` (${gi + 1}/${all.length})` : ""}`);
    g.forEach((f, i) => {
      const y = 1.95 + i * 1.6;
      sl.addShape(pptx.ShapeType.roundRect, { x: M + 0.25, y, w: W - 2 * M - 0.25, h: 1.4, rectRadius: 0.12, fill: { color: C.soft }, line: { color: C.soft } });
      sl.addText(clip(f.label, 60), { x: M + 0.55, y: y + 0.15, w: 3.6, h: 1.1, fontFace: FONT, fontSize: 14, bold: true, color: C.muted, margin: 0, valign: "middle", fit: "shrink" });
      sl.addText(clip(f.expression, 120), { x: 4.5, y: y + 0.1, w: 4.6, h: 1.2, fontFace: FONT, fontSize: 20, bold: true, color: C.violet, margin: 0, valign: "middle", fit: "shrink" });
      sl.addText(clip(f.meaning, 170), { x: 9.25, y: y + 0.15, w: 3.35, h: 1.1, fontFace: FONT, fontSize: 12, color: C.text, margin: 0, valign: "middle", fit: "shrink" });
    });
  });

  // 7. Exemples (2 par diapositive)
  chunk(n.examples || [], 2).forEach((g, gi, all) => {
    const sl = base("Pour illustrer", `Exemples${all.length > 1 ? ` (${gi + 1}/${all.length})` : ""}`);
    g.forEach((e, i) => {
      const x = M + 0.25 + i * 6.15;
      sl.addShape(pptx.ShapeType.roundRect, { x, y: 1.95, w: 5.95, h: 4.7, rectRadius: 0.12, fill: { color: "FFFFFF" }, line: { color: C.line, width: 1 } });
      sl.addText(`EXEMPLE ${gi * 2 + i + 1}`, { x: x + 0.35, y: 2.2, w: 5.2, h: 0.35, fontFace: FONT, fontSize: 11, bold: true, color: C.rose, charSpacing: 2, margin: 0 });
      sl.addText(clip(e.title, 90), { x: x + 0.35, y: 2.6, w: 5.25, h: 0.8, fontFace: FONT, fontSize: 18, bold: true, color: C.ink, margin: 0, valign: "top", fit: "shrink" });
      sl.addText(clip(e.explanation, 520), { x: x + 0.35, y: 3.45, w: 5.25, h: 3.0, fontFace: FONT, fontSize: 14, color: C.text, margin: 0, valign: "top", fit: "shrink", lineSpacingMultiple: 1.1 });
    });
  });

  // 8. L'essentiel (fiche)
  if (s?.essentials?.length) {
    chunk(s.essentials, 6).forEach((g, gi, all) => {
      const sl = base("Fiche de révision", `L'essentiel à retenir${all.length > 1 ? ` (${gi + 1}/${all.length})` : ""}`);
      g.forEach((t, i) => {
        const x = M + 0.25 + (i % 2) * 6.15;
        const y = 1.95 + Math.floor(i / 2) * 1.55;
        sl.addText(String(gi * 6 + i + 1), { x, y: y + 0.05, w: 0.5, h: 0.5, shape: pptx.ShapeType.roundRect, rectRadius: 0.1, fill: { color: C.violet }, line: { color: C.violet }, fontFace: FONT, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
        sl.addText(clip(t, 200), { x: x + 0.7, y, w: 5.2, h: 1.35, fontFace: FONT, fontSize: 14, color: C.text, margin: 0, valign: "top", fit: "shrink" });
      });
    });
  }

  // 9. Pièges
  if (s?.common_mistakes?.length) {
    const sl = base("Attention", "Pièges à éviter");
    s.common_mistakes.slice(0, 4).forEach((t, i) => {
      const x = M + 0.25 + (i % 2) * 6.15;
      const y = 1.95 + Math.floor(i / 2) * 2.4;
      sl.addShape(pptx.ShapeType.roundRect, { x, y, w: 5.95, h: 2.2, rectRadius: 0.12, fill: { color: C.roseSoft }, line: { color: C.roseSoft } });
      sl.addShape(pptx.ShapeType.rect, { x, y: y + 0.3, w: 0.08, h: 1.6, fill: { color: C.bordeaux }, line: { color: C.bordeaux } });
      sl.addText(clip(t, 240), { x: x + 0.4, y: y + 0.2, w: 5.3, h: 1.8, fontFace: FONT, fontSize: 15, color: C.text, margin: 0, valign: "middle", fit: "shrink" });
    });
  }

  // 10. Quiz (QCM des exercices)
  const qcm = (c.exercises?.items || []).filter((e) => e.type === "qcm" && (e.options?.length || 0) >= 2).slice(0, 5);
  qcm.forEach((q, qi) => {
    const sl = base(`Quiz · question ${qi + 1}/${qcm.length}`, "Teste-toi");
    sl.addText(clip(q.question, 220), { x: M + 0.25, y: 1.85, w: W - 2 * M - 0.25, h: 1.1, fontFace: FONT, fontSize: 22, bold: true, color: C.ink, margin: 0, valign: "top", fit: "shrink" });
    (q.options || []).slice(0, 4).forEach((o, i) => {
      const x = M + 0.25 + (i % 2) * 6.15;
      const y = 3.15 + Math.floor(i / 2) * 1.7;
      sl.addShape(pptx.ShapeType.roundRect, { x, y, w: 5.95, h: 1.5, rectRadius: 0.12, fill: { color: "FFFFFF" }, line: { color: C.line, width: 1 } });
      sl.addText(letter(i), { x: x + 0.3, y: y + 0.45, w: 0.6, h: 0.6, shape: pptx.ShapeType.roundRect, rectRadius: 0.1, fill: { color: C.soft }, line: { color: C.soft }, fontFace: FONT, fontSize: 16, bold: true, color: C.violet, align: "center", valign: "middle", margin: 0 });
      sl.addText(clip(o, 150), { x: x + 1.1, y: y + 0.15, w: 4.6, h: 1.2, fontFace: FONT, fontSize: 14, color: C.text, margin: 0, valign: "middle", fit: "shrink" });
    });
    if (typeof q.answer_index === "number") sl.addNotes(`Réponse : ${letter(q.answer_index)}. ${q.options?.[q.answer_index] ?? ""}\n${q.explanation || ""}`);
  });
  if (qcm.length) {
    const sl = base("Quiz", "Réponses");
    sl.addText(
      qcm.map((q, i) => ({
        text: `${i + 1}.  ${typeof q.answer_index === "number" ? `${letter(q.answer_index)} — ${clip(q.options?.[q.answer_index], 90)}` : clip(q.model_answer, 90)}`,
        options: { breakLine: true, paraSpaceAfter: 6, bold: true, color: C.ink },
      })).flatMap((r, i) => [r, { text: clip(qcm[i].explanation, 170), options: { breakLine: true, paraSpaceAfter: 14, bold: false, color: C.muted, fontSize: 13 } }]),
      { x: M + 0.25, y: 1.95, w: W - 2 * M - 0.25, h: 4.7, fontFace: FONT, fontSize: 16, valign: "top", margin: 0, fit: "shrink" },
    );
  }

  // 11. Clôture
  {
    const items = (s?.checklist?.length ? s.checklist : (n.plan || []).map((p) => heading(p.heading))).slice(0, 6);
    const sl = base("Avant l'évaluation", "Je suis prêt si je sais…");
    items.forEach((t, i) => {
      const y = 1.95 + i * 0.78;
      sl.addShape(pptx.ShapeType.roundRect, { x: M + 0.3, y: y + 0.12, w: 0.36, h: 0.36, rectRadius: 0.06, fill: { color: "FFFFFF" }, line: { color: C.violet, width: 1.5 } });
      sl.addText(clip(t, 150), { x: M + 0.9, y, w: W - 2 * M - 1, h: 0.6, fontFace: FONT, fontSize: 16, color: C.text, margin: 0, valign: "middle", fit: "shrink" });
    });
  }

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return out;
}
