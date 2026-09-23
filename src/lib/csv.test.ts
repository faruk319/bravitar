import { describe, expect, it } from "vitest";
import { decodeCsvBytes, detectDelimiter, isBlankRow, parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("parses plain rows and ignores a final newline", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\r\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles quotes, escaped quotes, delimiters and newlines inside quotes", () => {
    expect(parseCsv('name,note\n"Shaikh, Zoya","said ""hi""\nthen left"\n')).toEqual([
      ["name", "note"],
      ["Shaikh, Zoya", 'said "hi"\nthen left'],
    ]);
  });

  it("strips a BOM and keeps Devanagari intact", () => {
    expect(parseCsv("﻿नाम,मोबाइल\nआरव देशमुख,9876543210\n")).toEqual([["नाम", "मोबाइल"], ["आरव देशमुख", "9876543210"]]);
  });

  it("keeps blank records so row numbers match the spreadsheet", () => {
    const rows = parseCsv("a,b\n1,2\n,\n3,4\n");
    expect(rows).toHaveLength(4);
    expect(isBlankRow(rows[2] ?? [])).toBe(true);
  });

  it("keeps ragged rows as they are and empty trailing fields", () => {
    expect(parseCsv("a,b,c\n1\n1,2,\n")).toEqual([["a", "b", "c"], ["1"], ["1", "2", ""]]);
  });

  it("reads a lone quoted empty field", () => {
    expect(parseCsv('a\n""\n')).toEqual([["a"], [""]]);
  });

  it("uses the detected delimiter", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n")).toBe("\t");
    expect(detectDelimiter("a,b;c\n")).toBe(",");
    expect(detectDelimiter('"a;b",c\n')).toBe(",");
    expect(parseCsv("naam;phone\nAarav;98765 43210\n")).toEqual([["naam", "phone"], ["Aarav", "98765 43210"]]);
  });
});

describe("decodeCsvBytes", () => {
  const utf8 = (s: string) => new TextEncoder().encode(s);

  it("reads UTF-8 with and without a BOM", () => {
    expect(decodeCsvBytes(utf8("नाम,x"))).toEqual({ text: "नाम,x", encoding: "utf-8" });
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("नाम")]))).toEqual({ text: "नाम", encoding: "utf-8" });
  });

  it("reads UTF-16 LE by BOM (Excel 'Unicode text')", () => {
    const body = "नाम\tx";
    const bytes = new Uint8Array(2 + body.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < body.length; i++) {
      const c = body.charCodeAt(i);
      bytes[2 + i * 2] = c & 0xff;
      bytes[3 + i * 2] = c >> 8;
    }
    expect(decodeCsvBytes(bytes)).toEqual({ text: body, encoding: "utf-16le" });
  });

  it("falls back to Windows-1252 when the bytes are not UTF-8", () => {
    const bytes = new Uint8Array([0x4a, 0x6f, 0x73, 0xe9]); // "José" in Windows-1252
    expect(decodeCsvBytes(bytes)).toEqual({ text: "José", encoding: "windows-1252" });
  });
});

describe("toCsv", () => {
  it("quotes what needs quoting and round-trips through parseCsv", () => {
    const rows = [
      ["Name", "Note", "Import error"],
      ["आरव देशमुख", 'says "hi", then\nleaves', "No phone number"],
      [" padded ", "", "x"],
    ];
    const csv = toCsv(rows);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"says ""hi"", then\nleaves"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(parseCsv(csv)).toEqual(rows);
  });
});
