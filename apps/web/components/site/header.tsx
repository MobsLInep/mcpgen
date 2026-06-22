import { Github } from "lucide-react";
import { Logo } from "./logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-line-soft)] bg-[var(--color-canvas)]/70 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <a href="#top" className="flex items-center gap-2.5">
          <Logo className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight">mcpgen</span>
        </a>
        <nav className="flex items-center gap-1 text-sm">
          <a
            href="#what-is-mcp"
            className="hidden rounded-lg px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-ink)] sm:inline-block"
          >
            What is MCP?
          </a>
          <a
            href="#generate"
            className="hidden rounded-lg px-3 py-2 text-[var(--color-muted)] hover:text-[var(--color-ink)] sm:inline-block"
          >
            Generate
          </a>
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2 text-[var(--color-muted)] hover:border-[var(--color-signal-dim)] hover:text-[var(--color-signal)]"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">Docs</span>
          </a>
        </nav>
      </div>
    </header>
  );
}
