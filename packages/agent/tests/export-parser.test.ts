import { expect, test } from "bun:test";
import { parseExport, exportAttachment } from "../src/export-parser.ts";

test("parses Android and iOS exports, multiline text and explicit date order", () => {
  const source = "12/09/2026, 14:30 - Sam: Outage tomorrow\n08:00 to 10:00\n[12/09/2026, 14:31:00] +27 82 123 4567: <attached: schedule.pdf>\n12/09/2026, 14:32 - Messages are encrypted\n";
  const result = parseExport(source, "group", "Test", "DMY");
  expect(result.messages).toHaveLength(3);
  expect(result.messages[0]?.text).toContain("08:00 to 10:00");
  expect(new Date(result.messages[0]!.timestamp).toISOString()).toBe("2026-09-12T12:30:00.000Z");
  expect(result.messages[2]?.type).toBe("system");
  expect(exportAttachment(result.messages[1]!.text!)).toBe("schedule.pdf");
  expect(parseExport(source, "group", "Test", "DMY").messages.map(m => m.id)).toEqual(result.messages.map(m => m.id));
});

test("counts invalid dates rather than silently accepting them", () => {
  const result = parseExport("31/02/2026, 14:00 - Sam: invalid", "group", "Test", "DMY");
  expect(result.messages).toHaveLength(0);
  expect(result.skipped).toBe(1);
});

test("distinguishes repeated identical messages and supports AM/PM", () => {
  const result = parseExport("9/12/26, 2:30 PM - Sam: hello\n9/12/26, 2:30 PM - Sam: hello", "group", "Test", "MDY");
  expect(result.messages[0]?.id).not.toBe(result.messages[1]?.id);
  expect(new Date(result.messages[0]!.timestamp).toISOString()).toBe("2026-09-12T12:30:00.000Z");
});
