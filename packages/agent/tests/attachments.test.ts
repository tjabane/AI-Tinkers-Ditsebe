import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAttachment, closeExtractor } from "../src/attachments.ts";

test("extracts a local PDF schedule without an LLM", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ditsebe-pdf-test-"));
  try {
    const stream = "BT /F1 12 Tf 40 700 Td (Outage 08:00 to 10:00) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) {
      offsets.push(pdf.length);
      pdf += (i + 1) + " 0 obj\n" + objects[i] + "\nendobj\n";
    }
    const xref = pdf.length;
    pdf += "xref\n0 6\n0000000000 65535 f \n" + offsets.slice(1).map(n => String(n).padStart(10, "0") + " 00000 n \n").join("");
    pdf += "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    const path = join(directory, "schedule.pdf");
    await writeFile(path, pdf);
    const result = await extractAttachment(path, "pdf");
    expect(result.status).toBe("extracted");
    expect(result.text).toContain("Outage 08:00 to 10:00");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("extracts schedule text from a local image", async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const directory = await mkdtemp(join(tmpdir(), "ditsebe-ocr-test-"));
  try {
    const canvas = createCanvas(900, 150);
    const context = canvas.getContext("2d");
    context.fillStyle = "white"; context.fillRect(0, 0, 900, 150);
    context.fillStyle = "black"; context.font = "40px Arial";
    context.fillText("Outage 08:00 to 10:00", 30, 85);
    const path = join(directory, "schedule.png");
    await writeFile(path, canvas.toBuffer("image/png"));
    const result = await extractAttachment(path, "image");
    expect(result.text).toContain("08:00");
    expect(result.status).toBe("extracted");
  } finally { await closeExtractor(); await rm(directory, { recursive: true, force: true }); }
}, 60000);
