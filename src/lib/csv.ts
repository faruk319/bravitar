// RFC 4180 CSV plus what Excel produces in India: BOM, CRLF, and ";" or tab
// delimiters. Blank records are kept so row numbers match the spreadsheet.

export type Delimiter = "," | ";" | "\t";

// Most frequent candidate in the first record, outside quotes; ties go to ",".
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && (ch === "," || ch === ";" || ch === "\t")) counts[ch]++;
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return ",";
}

export function parseCsv(input: string, delimiter: Delimiter = detectDelimiter(input)): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
      fieldStart = true;
    } else if (ch === "\r" || ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStart = true;
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += ch;
      fieldStart = false;
    }
  }
  if (field !== "" || row.length > 0 || !fieldStart) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => c.trim() === "");
}

export type DecodedCsv = { text: string; encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252" };

// UTF-8 or UTF-16 by BOM, then strict UTF-8; anything else is read as
// Windows-1252, which is what older Excel saves as "CSV".
export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8" };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le" };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be" };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "windows-1252" };
  }
}

// Comma-separated, CRLF, with a BOM so Excel opens Devanagari correctly.
// `formulaSafe` (reports): text that Excel would run as a formula starts with ' instead.
export function toCsv(rows: string[][], { bom = true, formulaSafe = false }: { bom?: boolean; formulaSafe?: boolean } = {}): string {
  const safe = (v: string) => (formulaSafe && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v);
  const cell = (raw: string) => {
    const v = safe(raw);
    return /[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return (bom ? "﻿" : "") + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
