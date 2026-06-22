import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-[var(--color-line-soft)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 sm:flex-row">
        <div className="flex items-center gap-2.5">
          <Logo className="h-6 w-6" />
          <span className="text-sm text-[var(--color-muted)]">
            mcpgen — generate MCP servers from any API
          </span>
        </div>
        <p className="font-mono text-xs text-[var(--color-faint)]">
          built with the Model Context Protocol
        </p>
      </div>
    </footer>
  );
}
