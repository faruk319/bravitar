"use client";

import { Download, Upload } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Count } from "@/components/count";
import { fillLabels } from "@/components/shell/placeholder";
import { useBranch, useLabels } from "@/components/shell/tenant-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { decodeCsvBytes, isBlankRow, parseCsv, toCsv } from "@/lib/csv";
import {
  buildErrorRows,
  IMPORT_FIELD_LABELS,
  IMPORT_FIELDS,
  IMPORT_MAX_ROWS,
  type ImportField,
  type ImportIssue,
  type ImportMapping,
  type ImportResult,
  suggestMapping,
  validateMapping,
} from "@/modules/students/import-fields";

type Loaded = { name: string; text: string; encoding: string; header: string[]; records: string[][]; rowCount: number };
type Relation = "father" | "mother" | "other";
const MAX_BYTES = 5 * 1024 * 1024;
const SHOWN = 100;

// Choose file -> match columns -> check (dry run) -> import. The file stays in
// the browser; the server re-reads the posted text on every step.
export function ImportWizard() {
  const labels = useLabels();
  const { branches, currentBranchId } = useBranch();
  const [step, setStep] = useState<"file" | "map" | "check" | "done">("file");
  const [file, setFile] = useState<Loaded>();
  const [columns, setColumns] = useState<(ImportField | "")[]>([]);
  const [relation, setRelation] = useState<Relation>("father");
  const [branchId, setBranchId] = useState(currentBranchId !== "all" ? currentBranchId : (branches[0]?.id ?? ""));
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<ImportResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const label = (f: ImportField) => fillLabels(IMPORT_FIELD_LABELS[f], labels);
  const students = labels.student.many.toLowerCase();
  const mapping: ImportMapping = Object.fromEntries(columns.flatMap((f, i) => (f ? [[f, i]] : [])));
  const twice = columns.find((f, i) => f && columns.indexOf(f) !== i);
  const problems = file ? [...(twice ? [`Two columns are set to ${label(twice)}`] : []), ...validateMapping(mapping, file.header.length)] : [];

  async function onFile(f: File) {
    setError(undefined);
    if (f.size > MAX_BYTES) return setError("The file is larger than 5 MB. Split it.");
    const { text, encoding } = decodeCsvBytes(new Uint8Array(await f.arrayBuffer()));
    const records = parseCsv(text);
    const [header, ...rest] = records;
    const rowCount = rest.filter((r) => !isBlankRow(r)).length;
    if (!header || rowCount === 0) return setError("No rows under the header row.");
    if (rest.length > IMPORT_MAX_ROWS) return setError(`Up to ${IMPORT_MAX_ROWS} rows per file. Split it.`);
    const suggested = suggestMapping(header);
    setColumns(header.map((_, i) => (IMPORT_FIELDS.find((field) => suggested.mapping[field] === i) ?? "")));
    if (suggested.relation) setRelation(suggested.relation);
    setFile({ name: f.name, text, encoding, header, records, rowCount });
    setConsent(false);
    setStep("map");
  }

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    const options = { defaultRelation: relation, consentDeclared: consent, fileName: file.name, ...(branches.length > 1 && branchId ? { defaultBranchId: branchId } : {}) };
    const res = await fetch("/api/students/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: file.text, mapping, options, dryRun }) });
    const body = (await res.json().catch(() => ({}))) as ImportResult & { error?: string };
    setBusy(false);
    if (!res.ok) return setError(body.error ?? "Could not read the file");
    setResult(body);
    setStep(dryRun ? "check" : "done");
  }

  function downloadErrors() {
    if (!file || !result) return;
    const csv = toCsv(buildErrorRows(file.header, file.records, result.errors));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.name.replace(/\.[^.]+$/, "")}-errors.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const sample = (i: number) => file?.records.slice(1, 21).map((r) => r[i]?.trim()).find(Boolean) ?? "";
  const alert = error ? <p role="alert" className="text-label text-danger-600">{error}</p> : null;

  if (step === "file" || !file) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 p-6 text-center hover:bg-neutral-50">
          <Upload className="size-8 text-neutral-500" aria-hidden />
          <span className="text-body font-medium">Choose a CSV file</span>
          <span className="text-caption text-muted-foreground">First row must be column names</span>
          <input
            type="file"
            accept=".csv,.txt,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onFile(f);
            }}
          />
        </label>
        <a href="/templates/students.csv" download className="text-body text-accent-600 hover:underline">
          Download template
        </a>
        {alert}
      </div>
    );
  }

  if (step === "map") {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <p className="text-body text-muted-foreground">
          {file.name} · <Count value={file.rowCount} /> rows
        </p>
        {file.encoding === "windows-1252" ? <p className="text-label text-warning-600">Read as Windows text. If names look wrong, save as “CSV UTF-8”.</p> : null}
        <ul className="divide-y divide-border rounded-xl border border-neutral-100">
          {file.header.map((h, i) => (
            <li key={i} className="flex flex-col gap-2 p-3 md:flex-row md:items-center md:gap-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium">{h || `Column ${i + 1}`}</div>
                <div className="truncate text-caption text-muted-foreground">{sample(i) || "—"}</div>
              </div>
              <select
                aria-label={`Use ${h || `column ${i + 1}`} as`}
                value={columns[i] ?? ""}
                onChange={(e) => setColumns(columns.map((c, j) => (j === i ? (e.target.value as ImportField | "") : c)))}
                className="h-12 w-full rounded-lg border border-border bg-background px-3 text-body md:w-64"
              >
                <option value="">{"Don't import"}</option>
                {IMPORT_FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {label(f)}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Parent is usually" id="relation">
            <select id="relation" value={relation} onChange={(e) => setRelation(e.target.value as Relation)} className="h-12 rounded-lg border border-border bg-background px-3 text-body">
              <option value="father">Father</option>
              <option value="mother">Mother</option>
              <option value="other">Other</option>
            </select>
          </Field>
          {branches.length > 1 ? (
            <Field label="Branch when the file has none" id="branch">
              <select id="branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-12 rounded-lg border border-border bg-background px-3 text-body">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
        {problems.map((p) => (
          <p key={p} role="alert" className="text-label text-danger-600">
            {p}
          </p>
        ))}
        {alert}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setStep("file")} disabled={busy}>
            Back
          </Button>
          <Button size="lg" disabled={busy || problems.length > 0} onClick={() => void send(true)}>
            {busy ? `Checking ${file.rowCount} rows…` : "Check file"}
          </Button>
        </div>
      </div>
    );
  }

  if (!result) return null;
  const done = step === "done";
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <h2 className="text-heading">{done ? `Added ${result.studentsCreated} ${students}` : "Ready to import"}</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Tile label={`New ${students}`} value={result.studentsCreated} />
        <Tile label="New families" value={result.householdsCreated} />
        <Tile label="Join existing families" value={result.linkedToExisting} />
        <Tile label="Already here" value={result.skipped} />
        <Tile label="Can't import" value={result.errors.length} tone={result.errors.length ? "danger" : undefined} />
        <Tile label="Warnings" value={result.warnings.length} tone={result.warnings.length ? "warning" : undefined} />
      </div>

      {result.errors.length ? (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-heading">{"Can't import"}</h3>
            <Button variant="outline" onClick={downloadErrors}>
              <Download data-icon="inline-start" /> Download these rows
            </Button>
          </div>
          <Issues issues={result.errors} />
        </section>
      ) : null}
      {result.warnings.length ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-heading">Imported with a note</h3>
          <Issues issues={result.warnings} />
        </section>
      ) : null}

      {done ? (
        <div className="flex flex-wrap gap-2">
          <Button size="lg" nativeButton={false} render={<Link href="/students" />}>
            Go to {students}
          </Button>
          <Button variant="outline" onClick={() => setStep("file")}>
            Import another file
          </Button>
        </div>
      ) : (
        <>
          <label className="flex min-h-12 items-start gap-3 text-body">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-5 shrink-0" />
            Parents gave consent for these records (admission form or register)
          </label>
          {alert}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStep("map")} disabled={busy}>
              Back
            </Button>
            <Button size="lg" disabled={busy || !consent || result.studentsCreated === 0} onClick={() => void send(false)}>
              {busy ? "Importing…" : `Import ${result.studentsCreated} ${students}`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" | undefined }) {
  const color = tone === "danger" ? "text-danger-600" : tone === "warning" ? "text-warning-600" : "text-neutral-900";
  return (
    <div className="rounded-xl border border-neutral-100 p-3">
      <div className={`text-number ${color}`}>
        <Count value={value} />
      </div>
      <div className="text-caption text-muted-foreground">{label}</div>
    </div>
  );
}

function Issues({ issues }: { issues: ImportIssue[] }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-neutral-100">
      {issues.slice(0, SHOWN).map((issue) => (
        <li key={`${issue.row}-${issue.message}`} className="flex min-h-12 items-center gap-3 px-3 py-2 text-body">
          <span className="w-16 shrink-0 text-label text-muted-foreground tabular-nums">Row {issue.row}</span>
          <span>{issue.message}</span>
        </li>
      ))}
      {issues.length > SHOWN ? <li className="px-3 py-2 text-caption text-muted-foreground">…and {issues.length - SHOWN} more</li> : null}
    </ul>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
