const fs = require("fs");
const d = require("docx");
const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, AlignmentType, WidthType, BorderStyle,
  ShadingType, PageNumber, NumberFormat, Footer, LevelFormat, TabStopType, PositionalTab, PositionalTabAlignment,
  PositionalTabRelativeTo, PositionalTabLeader, PageBreak, VerticalAlign } = d;

const R = __dirname + "/../";
const FIG = __dirname + "/../figures/";
const NAME = process.argv[2];
const PAGES = fs.existsSync(`${__dirname}/pages-${NAME}.json`) ? JSON.parse(fs.readFileSync(`${__dirname}/pages-${NAME}.json`)) : {};
const FONT = "Times New Roman";
const W = 9638;

const runs = (text, base = {}) =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/).filter(Boolean).map(s =>
    s.startsWith("**") ? new TextRun({ ...base, text: s.slice(2, -2), bold: true })
    : s.startsWith("`") ? new TextRun({ ...base, text: s.slice(1, -1), font: "Courier New", size: 21 })
    : s.startsWith("_") && s.length > 2 ? new TextRun({ ...base, text: s.slice(1, -1), italics: true })
    : new TextRun({ ...base, text: s }));

const P = (text, o = {}) => new Paragraph({ alignment: o.align ?? AlignmentType.JUSTIFIED, spacing: { after: 120 },
  indent: o.indent ? { left: o.indent } : undefined, keepNext: o.keepNext, children: runs(text, o.run) });
const B = text => new Paragraph({ numbering: { reference: "bul", level: 0 }, alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 60 }, children: runs(text) });
const N = text => new Paragraph({ numbering: { reference: "num", level: 0, instance: N.k }, alignment: AlignmentType.JUSTIFIED,
  spacing: { after: 60 }, children: runs(text) });
N.k = 0;

const toc = [], figs = [], tabs = [];
let ch = 0, fig = 0, tab = 0, eq = 0;

const H1 = (title, numbered = true, brk = true) => {
  if (numbered) { ch++; fig = 0; tab = 0; eq = 0; }
  const text = numbered ? `Chapter ${ch}: ${title}` : title;
  toc.push({ level: 1, text });
  return new Paragraph({ heading: d.HeadingLevel.HEADING_1, pageBreakBefore: brk, spacing: brk ? undefined : { before: 360 },
    alignment: numbered ? AlignmentType.CENTER : AlignmentType.LEFT, children: [new TextRun(text)] });
};
const H2 = (num, title) => {
  toc.push({ level: 2, text: `${num}\t${title}`, key: `${num} ${title}` });
  return new Paragraph({ heading: d.HeadingLevel.HEADING_2, tabStops: [{ type: TabStopType.LEFT, position: 720 }],
    children: [new TextRun(`${num}\t${title}`)] });
};
const H3 = title => {
  const [num, ...rest] = title.split(" ");
  toc.push({ level: 3, text: `${num}\t${rest.join(" ")}`, key: title });
  return new Paragraph({ heading: d.HeadingLevel.HEADING_3, children: [new TextRun(title)] });
};

const png = f => { const b = fs.readFileSync(f); return [b, b.readUInt32BE(16), b.readUInt32BE(20)]; };
const Fig = (file, caption, widthFrac = 1) => {
  fig++;
  const label = `Figure ${ch}.${fig}`;
  figs.push({ text: `${label}: ${caption}`, key: `${label}:` });
  if (!fs.existsSync(FIG + file)) return [P(`[${label} pending: ${file}]`, { align: AlignmentType.CENTER }), new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
    children: [new TextRun({ text: `${label}: `, bold: true, size: 22 }), ...runs(caption, { size: 22 })] })];
  const [buf, w, h] = png(FIG + file);
  const px = Math.round(W / 15 * widthFrac);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60, line: 240 },
      children: [new ImageRun({ type: "png", data: buf, transformation: { width: px, height: Math.round(px * h / w) } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
      children: [new TextRun({ text: `${label}: `, bold: true, size: 22 }), ...runs(caption, { size: 22 })] }),
  ];
};
Fig.ref = (offset = 1) => `Figure ${ch}.${fig + offset}`;

const border = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const borders = { top: border, bottom: border, left: border, right: border };
const Tab = (caption, header, rows, widths) => {
  tab++;
  const label = `Table ${ch}.${tab}`;
  tabs.push({ text: `${label}: ${caption}`, key: `${label}:` });
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (t, i, head, keep = true) => new TableCell({ borders, width: { size: widths[i], type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER, margins: { top: 40, bottom: 40, left: 90, right: 90 },
    shading: head ? { fill: "DCE6F2", type: ShadingType.CLEAR, color: "auto" } : undefined,
    children: [new Paragraph({ keepNext: keep, spacing: { line: 240 }, alignment: i === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
      children: runs(String(t), { size: 21, bold: head }) })] });
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: `${label}: `, bold: true, size: 22 }), ...runs(caption, { size: 22 })] }),
    new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, alignment: AlignmentType.CENTER,
      rows: [new TableRow({ tableHeader: true, children: header.map((t, i) => cell(t, i, true)) }),
        ...rows.map((r, j) => new TableRow({ cantSplit: true, children: r.map((t, i) => cell(t, i, false, j < rows.length - 1)) }))] }),
    new Paragraph({ spacing: { after: 120 }, children: [] }),
  ];
};
Tab.ref = (offset = 1) => `Table ${ch}.${tab + offset}`;

const Eq = (text) => {
  eq++;
  return new Paragraph({ tabStops: [{ type: TabStopType.CENTER, position: W / 2 }, { type: TabStopType.RIGHT, position: W }],
    spacing: { before: 60, after: 120 }, children: [new TextRun("\t"), ...runs(text, { italics: false }), new TextRun(`\t(${ch}.${eq})`)] });
};
Eq.ref = (offset = 1) => `Equation (${ch}.${eq + offset})`;

const Code = lines => lines.map((l, i) => new Paragraph({ spacing: { line: 240, after: i === lines.length - 1 ? 160 : 0 }, keepNext: i < lines.length - 1, keepLines: true,
  indent: { left: 360 }, children: [new TextRun({ text: l, font: "Courier New", size: 18 })] }));

const body = [];
const add = (...xs) => xs.flat().forEach(x => body.push(x));

const finish = cfg => {
  add(H1("References", false));
  cfg.refs.forEach((r, i) => add(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 80 },
    indent: { left: 567, hanging: 567 }, children: [new TextRun(`[${i + 1}]\t`), ...runs(r)], tabStops: [{ type: TabStopType.LEFT, position: 567 }] })));
  add(H1("Appendix", false));
  add(new Paragraph({ spacing: { after: 120 }, keepNext: true, children: [new TextRun({ text: "Team Roles and Contributions:", bold: true })] }));
  cfg.team.forEach(([s, t]) => add(new Paragraph({ indent: { left: 720 }, spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text: `${s}: `, bold: true }), new TextRun(t)] })));
  add(new Paragraph({ spacing: { before: 240, after: 120 }, keepNext: true, children: [new TextRun({ text: "Source code:", bold: true })] }));
  add(P(cfg.source));
  const MEMBERS = cfg.members;
  const entry = (text, page, indent, bold) => new Paragraph({ spacing: { after: 30, line: 300 }, indent: { left: indent, hanging: indent ? 0 : 0 },
    tabStops: text.includes("\t") ? [{ type: TabStopType.LEFT, position: indent + 720 }] : [],
    children: [new TextRun({ text, bold }), new TextRun({ children: [new PositionalTab({ alignment: PositionalTabAlignment.RIGHT,
      relativeTo: PositionalTabRelativeTo.MARGIN, leader: PositionalTabLeader.DOT })] }), new TextRun({ text: String(page ?? "?"), bold })] });
  const plain = t => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 },
    children: [new TextRun({ text: t, bold: true, size: 32 })] });

  const prelim = [
    plain("Table of Contents"),
    ...toc.map(e => entry(e.text, PAGES[e.key ?? e.text], [0, 0, 360, 720][e.level], e.level === 1)),
    new Paragraph({ children: [new PageBreak()] }), plain("List of Figures"),
    ...figs.map(e => entry(e.text, PAGES[e.key], 0, false)),
    new Paragraph({ spacing: { before: 360 }, children: [] }), plain("List of Tables"),
    ...tabs.map(e => entry(e.text, PAGES[e.key], 0, false)),
  ];

  const [logo, lw, lh] = png(__dirname + "/../figures/jiit-logo.png");
  const C = (t, size, bold, after = 0) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after },
    children: [new TextRun({ text: t, size, bold })] });
  const sub = (label, val) => [new TextRun({ text: label, bold: true }), new TextRun(val)];
  const member = (lead, enr, name) => new Paragraph({ indent: { left: 1000 }, spacing: { after: 0 },
    children: [new TextRun({ text: lead ? "Submitted By: " : "", bold: true }),
      ...(lead ? [] : [new TextRun({ text: "Submitted By: ", bold: true, color: "FFFFFF" })]),
      new TextRun(`Enrolment No.: ${enr}, Name: ${name}`)] });
  const cover = [
    new Paragraph({ spacing: { before: 600 }, children: [] }),
    C("Jaypee Institute of Information Technology, Noida", 32, true, 240),
    C("DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING AND", 24, false), C("INFORMATION TECHNOLOGY", 24, false, 720),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: `Project Title: ${cfg.title[0]}`, bold: true, size: 32 })] }),
    C(cfg.title[1], 32, true, 600),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 720 },
      children: [new ImageRun({ type: "png", data: logo, transformation: { width: 190, height: Math.round(190 * lh / lw) } })] }),
    ...MEMBERS.map(([e, n], i) => member(i === 0, e, n)),
    new Paragraph({ spacing: { before: 1000 }, children: [] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: sub("Course Name: ", cfg.course) }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Course Code: ${cfg.code}`, bold: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: sub("Program: ", "B. Tech. CSE/IT") }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("Third Year 5"), new TextRun({ text: "th", superScript: true }), new TextRun(" Semester")] }),
  ];

  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })] });
  const page = { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, footer: 567 } };
  const H = (size, align, before, after) => ({ run: { font: FONT, size, bold: true, color: "000000" },
    paragraph: { alignment: align, spacing: { before, after, line: 360 }, keepNext: true, keepLines: true } });

  const doc = new Document({
    creator: "Harsh Jha", title: cfg.title.join(" "),
    styles: {
      default: { document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 360 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, ...H(32, AlignmentType.CENTER, 0, 360) },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, ...H(28, AlignmentType.LEFT, 240, 120) },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, ...H(24, AlignmentType.LEFT, 200, 80) },
      ],
    },
    numbering: { config: [
      { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "num", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ] },
    sections: [
      { properties: { page }, children: cover },
      { properties: { page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } } }, footers: { default: footer }, children: prelim },
      { properties: { page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } }, footers: { default: footer }, children: body },
    ],
  });
  fs.writeFileSync(`${__dirname}/keys-${NAME}.json`, JSON.stringify([...toc.map(e => e.key ?? e.text), ...figs.map(e => e.key), ...tabs.map(e => e.key)]));
  return Packer.toBuffer(doc).then(b => fs.writeFileSync(R + cfg.file, b));
};

module.exports = { d, P, B, N, H1, H2, H3, Fig, Tab, Eq, Code, add, finish, AlignmentType };
