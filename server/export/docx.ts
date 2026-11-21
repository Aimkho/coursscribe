import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  TextRun,
} from "docx";
import type { Course } from "@shared/schema";
import { type Block, courseMeta, letter } from "./blocks";

const C = { violet: "7D4FFE", lilac: "C49FFF", rose: "FE277E", bordeaux: "8A0D1E", ink: "1A1033", text: "2B2440", muted: "6B6680", soft: "F5F1FF", roseSoft: "FFF0F6" };
const FONT = "Calibri";

const run = (text: string, o: { bold?: boolean; italics?: boolean; color?: string; size?: number; caps?: boolean } = {}) =>
  new TextRun({ text, font: FONT, bold: o.bold, italics: o.italics, color: o.color ?? C.text, size: o.size ?? 22, allCaps: o.caps });

/** Plusieurs lignes dans un même paragraphe. */
const lines = (text: string, o: Parameters<typeof run>[1] = {}) =>
  text.split("\n").map((l, i) => new TextRun({ text: l, font: FONT, bold: o?.bold, italics: o?.italics, color: o?.color ?? C.text, size: o?.size ?? 22, break: i ? 1 : 0 }));

export async function renderDocx(c: Course, blocks: Block[]): Promise<Buffer> {
  const children: Paragraph[] = [];

  // En-tête du document
  children.push(
    new Paragraph({ spacing: { after: 80 }, children: [run("COURSSCRIBE", { bold: true, color: C.violet, size: 18 })] }),
    new Paragraph({ spacing: { after: 60 }, children: [run(courseMeta(c).toUpperCase(), { bold: true, color: C.muted, size: 17 })] }),
    new Paragraph({
      spacing: { after: 320 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.rose, space: 8 } },
      children: [run(c.title, { bold: true, color: C.ink, size: 44 })],
    }),
  );

  let firstPart = true;
  for (const b of blocks) {
    switch (b.t) {
      case "part":
        children.push(
          new Paragraph({
            pageBreakBefore: !firstPart,
            spacing: { before: firstPart ? 120 : 0, after: 40 },
            children: [run((b.kicker || "").toUpperCase(), { bold: true, color: C.violet, size: 18 })],
          }),
          new Paragraph({
            spacing: { after: 220 },
            border: { left: { style: BorderStyle.SINGLE, size: 24, color: C.violet, space: 10 } },
            children: [run(b.text, { bold: true, color: C.ink, size: 36 })],
          }),
        );
        firstPart = false;
        break;
      case "h2":
        children.push(
          new Paragraph({
            spacing: { before: 280, after: 120 },
            keepNext: true,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.lilac, space: 4 } },
            children: [run(b.text, { bold: true, color: C.ink, size: 28 })],
          }),
        );
        break;
      case "h3":
        children.push(new Paragraph({ spacing: { before: 200, after: 80 }, keepNext: true, children: [run(b.text, { bold: true, color: C.violet, size: 24 })] }));
        break;
      case "p":
        children.push(new Paragraph({ spacing: { after: 140, line: 300 }, children: [run(b.text, { color: b.muted ? C.muted : C.text })] }));
        break;
      case "callout": {
        const dark = b.tone === "dark";
        const fill = dark ? C.ink : b.tone === "rose" ? C.roseSoft : C.soft;
        const accent = dark ? C.lilac : b.tone === "rose" ? C.bordeaux : C.violet;
        const border = { style: BorderStyle.SINGLE, size: 4, color: fill, space: 8 };
        children.push(
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill, color: "auto" },
            border: { top: border, bottom: border, left: { style: BorderStyle.SINGLE, size: 24, color: dark ? C.violet : accent, space: 8 }, right: border },
            spacing: { before: 120, after: 0 },
            keepNext: true,
            children: [run(b.label.toUpperCase(), { bold: true, color: accent, size: 17 })],
          }),
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill, color: "auto" },
            border: { top: border, bottom: border, left: { style: BorderStyle.SINGLE, size: 24, color: dark ? C.violet : accent, space: 8 }, right: border },
            spacing: { after: 220, line: 300 },
            children: lines(b.text, { bold: dark, color: dark ? "FFFFFF" : C.text, size: dark ? 25 : 22 }),
          }),
        );
        break;
      }
      case "tags":
        children.push(
          new Paragraph({
            spacing: { after: 200 },
            children: b.items.flatMap((t, i) => [
              ...(i ? [run("   ·   ", { color: C.lilac, size: 18 })] : []),
              run(t, { bold: true, color: C.violet, size: 18 }),
            ]),
          }),
        );
        break;
      case "bullets":
        b.items.forEach((it) => {
          const box = it.startsWith("☐");
          children.push(
            new Paragraph({
              numbering: box ? undefined : { reference: "puces", level: 0 },
              indent: box ? { left: 360 } : undefined,
              spacing: { after: 80, line: 290 },
              children: box ? [run("☐  ", { color: C.violet }), run(it.replace(/^☐\s*/, ""))] : [run(it)],
            }),
          );
        });
        children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
        break;
      case "numbered":
        b.items.forEach((it, i) =>
          children.push(
            new Paragraph({
              indent: { left: 480, hanging: 480 },
              spacing: { after: 100, line: 290 },
              children: [run(`${String(i + 1).padStart(2, "0")}   `, { bold: true, color: C.violet }), run(it)],
            }),
          ),
        );
        break;
      case "def":
        children.push(
          new Paragraph({
            spacing: { after: 140, line: 290 },
            indent: { left: 200 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: C.lilac, space: 8 } },
            children: [run(b.term, { bold: true, color: C.ink }), new TextRun({ text: "", break: 1 }), run(b.text)],
          }),
        );
        break;
      case "formula":
        children.push(
          new Paragraph({
            spacing: { before: 80, after: 160, line: 290 },
            shading: { type: ShadingType.CLEAR, fill: C.soft, color: "auto" },
            border: { left: { style: BorderStyle.SINGLE, size: 18, color: C.violet, space: 8 } },
            children: [
              run(b.label, { bold: true, color: C.muted, size: 19 }),
              new TextRun({ text: "", break: 1 }),
              run(b.expr, { bold: true, color: C.violet, size: 26 }),
              ...(b.meaning ? [new TextRun({ text: "", break: 1 }), run(b.meaning, { color: C.muted, size: 20 })] : []),
            ],
          }),
        );
        break;
      case "qa":
        children.push(
          new Paragraph({ spacing: { before: 80, after: 40 }, keepNext: true, children: [run("Q  ", { bold: true, color: C.rose }), run(b.q, { bold: true, color: C.ink })] }),
          new Paragraph({ spacing: { after: 160, line: 290 }, indent: { left: 340 }, children: [run(b.a)] }),
        );
        break;
      case "question":
        children.push(
          new Paragraph({
            spacing: { before: 200, after: 40 },
            keepNext: true,
            children: [run(`${String(b.n).padStart(2, "0")}   `, { bold: true, color: C.lilac, size: 22 }), run(b.meta.toUpperCase(), { bold: true, color: C.muted, size: 16 })],
          }),
          new Paragraph({ spacing: { after: 80, line: 290 }, keepNext: !!b.options?.length, indent: { left: 500 }, children: [run(b.text, { bold: true, color: C.ink })] }),
          ...(b.options || []).map(
            (o, i, arr) =>
              new Paragraph({
                spacing: { after: 40 },
                keepNext: i < arr.length - 1,
                indent: { left: 800, hanging: 300 },
                children: [run(`${letter(i)}.  `, { bold: true, color: C.violet }), run(o)],
              }),
          ),
        );
        break;
      case "answer":
        children.push(
          new Paragraph({
            spacing: { before: 100, after: b.explanation ? 20 : 120, line: 280 },
            indent: { left: 500, hanging: 500 },
            children: [run(`${String(b.n).padStart(2, "0")}   `, { bold: true, color: C.rose }), run(b.text, { bold: b.text.length <= 140, color: C.ink })],
          }),
          ...(b.explanation ? [new Paragraph({ spacing: { after: 120, line: 280 }, indent: { left: 500 }, children: [run(b.explanation, { color: C.muted, size: 20 })] })] : []),
        );
        break;
    }
  }

  const doc = new Document({
    creator: "CoursScribe",
    title: c.title,
    styles: { default: { document: { run: { font: FONT, size: 22, color: C.text } } } },
    numbering: {
      config: [
        {
          reference: "puces",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } }, run: { color: C.rose } } }],
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${c.title} · CoursScribe   `, font: FONT, size: 16, color: C.muted }),
                  new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: C.violet, bold: true }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
