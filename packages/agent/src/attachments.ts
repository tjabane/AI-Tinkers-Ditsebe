import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

let ocr: Promise<import("tesseract.js").Worker> | undefined;
async function recognize(image: string | Buffer): Promise<string> {
  if (!ocr) {
    await mkdir(resolve("data/ocr"), { recursive: true });
    ocr = import("tesseract.js").then(({ createWorker }) => createWorker("eng", 1, { cachePath: resolve("data/ocr") }));
  }
  return (await (await ocr).recognize(image)).data.text.trim();
}
export async function extractAttachment(path: string, kind: "pdf" | "image"): Promise<{ text: string; status: string }> {
  if (kind === "pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true });
    const doc = await task.promise;
    try {
      const pages: string[] = [];
      for (let n = 1; n <= Math.min(doc.numPages, 100); n++) {
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        let text = content.items.map(item => "str" in item ? item.str : "").join(" ").trim();
        if (!text) {
          const { createCanvas } = await import("@napi-rs/canvas");
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(2, 2500 / Math.max(base.width, base.height)) });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          await page.render({ canvas: canvas as never, canvasContext: canvas.getContext("2d") as never, viewport }).promise;
          text = await recognize(canvas.toBuffer("image/png"));
        }
        pages.push(text);
      }
      const text = pages.join("\n").trim();
      return { text, status: !text ? "needs_ocr" : doc.numPages > 100 ? "extracted_partial" : "extracted" };
    } finally { await task.destroy(); }
  }
  const text = await recognize(path);
  return { text, status: text ? "extracted" : "no_text" };
}
export async function closeExtractor() {
  if (ocr) { await (await ocr).terminate(); ocr = undefined; }
}
