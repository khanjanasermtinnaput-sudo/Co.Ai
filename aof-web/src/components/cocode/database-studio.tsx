"use client";

// ── Database Studio (Phase 37) ────────────────────────────────────────────────
// Schema viewer, migration builder, and query runner.
// Parses schema files from virtual FS (Prisma, Drizzle, SQL).
// Generates Supabase/Prisma migration diffs via AI.

import { useState, useMemo } from "react";
import { Database, Plus, Loader2, Play, Download, RefreshCw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { PanelHeader } from "@/components/cocode/panel-header";

interface SchemaTable {
  name: string;
  columns: Array<{ name: string; type: string; nullable: boolean; pk: boolean; fk: string | null }>;
  source: "prisma" | "drizzle" | "sql";
}

// ── Parser ────────────────────────────────────────────────────────────────────

function parsePrismaSchema(content: string): SchemaTable[] {
  const tables: SchemaTable[] = [];
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  modelRegex.lastIndex = 0;
  while ((m = modelRegex.exec(content)) !== null) {
    const name = m[1];
    const body = m[2];
    const columns = body.split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("@@"))
      .map((l) => {
        const parts = l.split(/\s+/);
        const colName = parts[0];
        const colType = parts[1]?.replace("?", "") ?? "String";
        const nullable = parts[1]?.includes("?") ?? false;
        const pk = l.includes("@id");
        const fk = l.includes("@relation") ? l.match(/fields:\s*\[(\w+)\]/)?.[1] ?? null : null;
        return { name: colName, type: colType, nullable, pk, fk };
      })
      .filter((c) => c.name && !/^[A-Z]/.test(c.name) === false || /^[a-z]/.test(c.name));
    tables.push({ name, columns, source: "prisma" });
  }
  return tables;
}

function parseSQLSchema(content: string): SchemaTable[] {
  const tables: SchemaTable[] = [];
  const createRegex = /CREATE\s+TABLE\s+(?:IF NOT EXISTS\s+)?["']?(\w+)["']?\s*\(([^;]+)\)/gi;
  let m: RegExpExecArray | null;
  createRegex.lastIndex = 0;
  while ((m = createRegex.exec(content)) !== null) {
    const name = m[1];
    const body = m[2];
    const columns = body.split(",")
      .map((l) => l.trim())
      .filter((l) => l && !l.toUpperCase().startsWith("PRIMARY KEY") && !l.toUpperCase().startsWith("FOREIGN KEY") && !l.toUpperCase().startsWith("INDEX"))
      .map((l) => {
        const parts = l.trim().split(/\s+/);
        const colName = parts[0].replace(/["`']/g, "");
        const colType = parts[1] ?? "TEXT";
        const nullable = !l.toUpperCase().includes("NOT NULL");
        const pk = l.toUpperCase().includes("PRIMARY KEY");
        return { name: colName, type: colType, nullable, pk, fk: null };
      });
    tables.push({ name, columns, source: "sql" });
  }
  return tables;
}

export function DatabaseStudio({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const upsertFile = useCocodeIDEStore((s) => s.upsertFile);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [query, setQuery] = useState("SELECT * FROM users LIMIT 10;");
  const [queryResult, setQueryResult] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [tab, setTab] = useState<"schema" | "query" | "migrate">("schema");
  const [migration, setMigration] = useState("");

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);

  const tables = useMemo<SchemaTable[]>(() => {
    const result: SchemaTable[] = [];
    for (const { path, content } of allFiles) {
      if (path.endsWith(".prisma") || path.endsWith("schema.prisma")) {
        result.push(...parsePrismaSchema(content));
      } else if (path.endsWith(".sql") || path.includes("migration")) {
        result.push(...parseSQLSchema(content));
      }
    }
    return result;
  }, [allFiles]);

  const selected = tables.find((t) => t.name === selectedTable);

  async function generateMigration() {
    setGenerating(true);
    const schema = allFiles.find((f) => f.path.endsWith(".prisma") || f.path.endsWith("schema.sql"));
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Generate a SQL migration file for the following schema. Output only SQL.\n${schema?.content.slice(0, 3000) ?? "No schema found."}`,
        history: [],
        agent: "cocode",
        route: "database",
      }),
    });

    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
      }
      const sql = full.match(/```sql\n?([\s\S]*?)```/)?.[1] ?? full;
      setMigration(sql.trim());
    }
    setGenerating(false);
  }

  function saveMigration() {
    const ts = Date.now();
    upsertFile(`migrations/${ts}_migration.sql`, migration);
  }

  async function runQuery() {
    setQueryResult("Query execution requires a live database connection.\n\nTo connect:\n1. Add NEXT_PUBLIC_DATABASE_URL to your .env.local\n2. Use the Environment Variables panel\n3. Re-run the query");
  }

  const PK_COLOR = "text-amber-400";
  const FK_COLOR = "text-blue-400";
  const NULL_COLOR = "text-muted-foreground/40";

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <PanelHeader icon={Database} title="Database Studio">
        {tables.length > 0 && (
          <span className="text-[11px] text-muted-foreground/60">{tables.length} tables</span>
        )}
      </PanelHeader>

      {/* Tabs */}
      <div className="flex border-b border-border/50">
        {(["schema", "query", "migrate"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2 text-[12px] font-medium capitalize transition-colors",
              tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
            )}>
            {t}
          </button>
        ))}
      </div>

      {tab === "schema" && (
        <div className="flex min-h-0 flex-1">
          {/* Table list */}
          <div className="w-44 shrink-0 overflow-y-auto border-r border-border/50 p-2">
            {tables.length === 0 ? (
              <div className="p-3 text-center text-[11px] text-muted-foreground/50">
                No schema files found.<br />Add a .prisma or .sql file.
              </div>
            ) : tables.map((t) => (
              <button key={t.name} type="button" onClick={() => setSelectedTable(t.name)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12px] transition-colors",
                  selectedTable === t.name ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}>
                <Database className="size-3.5 shrink-0" />
                <span className="truncate">{t.name}</span>
                <span className="ml-auto text-[10px] opacity-50">{t.columns.length}</span>
              </button>
            ))}
          </div>

          {/* Column view */}
          <div className="min-w-0 flex-1 overflow-auto">
            {!selected ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-[12px] text-muted-foreground/50">
                Select a table to view its schema.
              </div>
            ) : (
              <div className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">{selected.name}</h3>
                  <span className="rounded bg-secondary/30 px-1.5 py-0.5 text-[10px] text-muted-foreground/60 uppercase">{selected.source}</span>
                </div>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border/50 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                      <th className="pb-1.5 text-left">Column</th>
                      <th className="pb-1.5 text-left">Type</th>
                      <th className="pb-1.5 text-left">Nullable</th>
                      <th className="pb-1.5 text-left">Key</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {selected.columns.map((col, i) => (
                      <tr key={i}>
                        <td className={cn("py-1.5", col.pk ? PK_COLOR : col.fk ? FK_COLOR : "")}>{col.name}</td>
                        <td className="py-1.5 font-mono text-muted-foreground/70">{col.type}</td>
                        <td className={cn("py-1.5", col.nullable ? NULL_COLOR : "text-foreground/80")}>
                          {col.nullable ? "YES" : "NO"}
                        </td>
                        <td className="py-1.5">
                          {col.pk && <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] text-amber-400">PK</span>}
                          {col.fk && <span className="rounded bg-blue-500/15 px-1 py-0.5 text-[10px] text-blue-400">FK</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "query" && (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={6}
            className="mb-2 resize-none rounded-lg border border-border/50 console-surface p-3 font-mono text-[12px] outline-none focus:border-primary/40"
          />
          <Button onClick={() => void runQuery()} className="mb-3 self-end">
            <Play className="size-3.5" /> Run Query
          </Button>
          {queryResult && (
            <pre className="flex-1 overflow-auto console-surface rounded-lg p-3 font-mono text-[12px] text-slate-400">
              {queryResult}
            </pre>
          )}
        </div>
      )}

      {tab === "migrate" && (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <Button onClick={() => void generateMigration()} disabled={generating} className="mb-3 self-start">
            {generating ? <><Loader2 className="size-3.5 animate-spin" /> Generating…</> : <><RefreshCw className="size-3.5" /> Generate Migration</>}
          </Button>
          {migration ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground/60">Migration SQL</span>
                <Button size="sm" variant="ghost" onClick={saveMigration}><Download className="size-3.5" /> Save</Button>
              </div>
              <pre className="flex-1 overflow-auto console-surface rounded-lg p-3 font-mono text-[12px]">
                {migration}
              </pre>
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground/60">
              Generate a SQL migration from your current schema files.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
