#!/usr/bin/env node
/**
 * Export standard_prescriptions_combined.json to Word (.docx) for doctor review.
 * Output: radhakishan_system/data/standard_prescriptions_review.docx
 */
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  PageBreak,
} = require("docx");
const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const protocols = require(
  path.join(dataDir, "standard_prescriptions_combined.json"),
);

// Group by category
const byCategory = {};
protocols.forEach((p) => {
  const cat = p.category || "Uncategorized";
  if (!byCategory[cat]) byCategory[cat] = [];
  byCategory[cat].push(p);
});

const FONT = "Calibri";
const SIZE = 22; // half-points, 22 = 11pt

function bold(text) {
  return new TextRun({ text, bold: true, font: FONT, size: SIZE });
}
function normal(text) {
  return new TextRun({ text, font: FONT, size: SIZE });
}
function italic(text) {
  return new TextRun({ text, italics: true, font: FONT, size: SIZE });
}
function colored(text, color) {
  return new TextRun({ text, color, bold: true, font: FONT, size: SIZE });
}

function drugParagraphs(label, drugs, color) {
  if (!drugs || !drugs.length) return [];
  const paras = [
    new Paragraph({
      text: label,
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 120, after: 60 },
    }),
  ];
  drugs.forEach((d) => {
    const runs = [bold(d.drug)];
    if (d.notes) runs.push(normal(" — " + d.notes));
    if (d.is_new_2024_2025) runs.push(colored(" [NEW 2024-25]", "FF0000"));
    paras.push(
      new Paragraph({
        children: [normal("  • "), ...runs],
        spacing: { after: 40 },
      }),
    );
  });
  return paras;
}

function listParagraphs(label, items, heading) {
  if (!items || !items.length) return [];
  const paras = [
    new Paragraph({
      text: label,
      heading: heading || HeadingLevel.HEADING_3,
      spacing: { before: 120, after: 60 },
    }),
  ];
  items.forEach((item) => {
    const text =
      typeof item === "string"
        ? item
        : item.name +
          (item.indication ? " — " + item.indication : "") +
          (item.urgency && item.urgency !== "routine"
            ? " [" + item.urgency.toUpperCase() + "]"
            : "");
    paras.push(
      new Paragraph({
        children: [normal("  • " + text)],
        spacing: { after: 40 },
      }),
    );
  });
  return paras;
}

function fieldParagraph(label, value) {
  if (!value) return [];
  return [
    new Paragraph({
      text: label,
      heading: HeadingLevel.HEADING_3,
      spacing: { before: 120, after: 60 },
    }),
    new Paragraph({
      children: [normal(String(value))],
      spacing: { after: 80 },
    }),
  ];
}

// Build document sections
const children = [];

// Title page — H1 for hospital name, subtitle below
children.push(
  new Paragraph({
    children: [
      new TextRun({
        text: "Radhakishan Hospital — Standard Prescription Protocols",
        bold: true,
        font: FONT,
        size: 36,
      }),
    ],
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }),
);
children.push(
  new Paragraph({
    children: [
      new TextRun({
        text: "Pediatric OPD — For Doctor Review",
        font: FONT,
        size: 26,
        italics: true,
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }),
);
children.push(
  new Paragraph({
    children: [
      normal(
        `Total: ${protocols.length} protocols across ${Object.keys(byCategory).length} categories`,
      ),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
  }),
);
children.push(
  new Paragraph({
    children: [
      normal(
        `Generated: ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`,
      ),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }),
);

// Table of contents summary
children.push(
  new Paragraph({
    text: "Category Summary",
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
  }),
);
Object.entries(byCategory)
  .sort((a, b) => b[1].length - a[1].length)
  .forEach(([cat, items]) => {
    children.push(
      new Paragraph({
        children: [bold(cat), normal(` — ${items.length} protocols`)],
        spacing: { after: 60 },
      }),
    );
  });

// Each category
const sortedCategories = Object.keys(byCategory).sort();
sortedCategories.forEach((cat) => {
  children.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
  );
  children.push(
    new Paragraph({
      text: cat,
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 200 },
    }),
  );

  byCategory[cat].forEach((p, idx) => {
    // Protocol header
    children.push(
      new Paragraph({
        children: [
          colored(`${p.icd10}`, "0000AA"),
          normal(" — "),
          bold(p.diagnosis_name),
          p.severity && p.severity !== "any"
            ? italic(` [${p.severity}]`)
            : normal(""),
        ],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 100 },
      }),
    );

    // Metadata line (not a heading — just inline info)
    const metaParts = [];
    if (p.snomed_code) metaParts.push("SNOMED: " + p.snomed_code);
    if (p.duration_days_default)
      metaParts.push("Duration: " + p.duration_days_default + " days");
    if (p.source) metaParts.push("Source: " + p.source);
    if (metaParts.length) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: metaParts.join("  |  "),
              font: FONT,
              size: 20,
              italics: true,
              color: "666666",
            }),
          ],
          spacing: { after: 100 },
        }),
      );
    }

    // Drugs
    children.push(
      ...drugParagraphs("First-Line", p.first_line_drugs, "0000CC"),
    );
    children.push(
      ...drugParagraphs("Second-Line", p.second_line_drugs, "666600"),
    );

    // Investigations
    children.push(...listParagraphs("Investigations", p.investigations));

    // Counselling
    children.push(...listParagraphs("Counselling", p.counselling));

    // Warning signs
    children.push(...listParagraphs("Warning Signs", p.warning_signs));

    // Referral & hospitalisation
    children.push(...fieldParagraph("Referral Criteria", p.referral_criteria));
    children.push(
      ...fieldParagraph("Hospitalisation Criteria", p.hospitalisation_criteria),
    );

    // Notes & guidelines
    children.push(...fieldParagraph("Notes", p.notes));
    children.push(...fieldParagraph("Guideline Changes", p.guideline_changes));

    // Separator
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: "─".repeat(80), color: "CCCCCC", size: 16 }),
        ],
        spacing: { before: 100, after: 100 },
      }),
    );
  });
});

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT, size: SIZE },
      },
      heading1: {
        run: { font: FONT, size: 32, bold: true, color: "1F3864" },
        paragraph: { spacing: { before: 360, after: 200 } },
      },
      heading2: {
        run: { font: FONT, size: 26, bold: true, color: "2E75B6" },
        paragraph: { spacing: { before: 280, after: 120 } },
      },
      heading3: {
        run: { font: FONT, size: 22, bold: true, color: "404040" },
        paragraph: { spacing: { before: 160, after: 80 } },
      },
      title: {
        run: { font: FONT, size: 36, bold: true, color: "1F3864" },
        paragraph: { spacing: { before: 0, after: 200 } },
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 900, right: 900 },
        },
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then((buffer) => {
  const outPath = path.join(dataDir, "standard_prescriptions_review.docx");
  fs.writeFileSync(outPath, buffer);
  console.log(`Exported ${protocols.length} protocols to:\n${outPath}`);
});
