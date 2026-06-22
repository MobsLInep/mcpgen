import { FileJson, ShieldCheck, Workflow } from "lucide-react";

const CARDS = [
  {
    icon: FileJson,
    title: "Bring your API",
    body: "An OpenAPI spec, a GraphQL schema, or a code repo. mcpgen parses it into a normalized set of operations — no manual mapping.",
  },
  {
    icon: Workflow,
    title: "Get MCP tools",
    body: "Each operation becomes a typed MCP tool with a Zod-validated input schema and a safe HTTP handler, ready for any MCP client.",
  },
  {
    icon: ShieldCheck,
    title: "Proven to run",
    body: "Before you download, the server is installed, built, booted, and smoke-called in a sandbox — with self-repair if something breaks.",
  },
];

export function WhatIsMcp() {
  return (
    <section
      id="what-is-mcp"
      className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16"
    >
      <div className="max-w-2xl">
        <p className="eyebrow">The 30-second version</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">
          The Model Context Protocol lets AI agents call your tools.
        </h2>
        <p className="mt-4 text-base leading-relaxed text-[var(--color-muted)]">
          MCP is the open standard for connecting AI assistants like Claude to
          real systems. An{" "}
          <span className="text-[var(--color-ink)]">MCP server</span> exposes
          your API as a set of callable <em>tools</em> the agent can discover
          and invoke. Writing one by hand is tedious and easy to get wrong —
          mcpgen writes it for you, and checks its own work.
        </p>
      </div>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {CARDS.map((c) => (
          <div
            key={c.title}
            className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]/50 p-6 transition-colors hover:border-[var(--color-signal-dim)]"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)]">
              <c.icon className="h-5 w-5 text-[var(--color-signal)]" />
            </div>
            <h3 className="mt-4 text-lg font-semibold tracking-tight">
              {c.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
              {c.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
