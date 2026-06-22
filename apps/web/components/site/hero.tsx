import { ArrowDown, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DemoLoop } from "./demo-loop";

export function Hero() {
  return (
    <section
      id="top"
      className="relative mx-auto max-w-6xl px-5 pt-16 pb-12 sm:pt-24"
    >
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
        <div className="animate-[rise_0.5s_cubic-bezier(0.2,0.7,0.2,1)_both]">
          <Badge variant="signal" className="mb-5">
            <Zap className="h-3.5 w-3.5" />
            OpenAPI · GraphQL → MCP
          </Badge>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Turn any API into a{" "}
            <span className="text-gradient">working MCP server</span> in 30
            seconds.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--color-muted)]">
            Paste an OpenAPI spec or GraphQL schema. mcpgen detects the
            operations, generates a typed, secure Model Context Protocol server,
            and proves it runs — then hands you a downloadable project your AI
            agent can call.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#generate"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-[var(--color-signal)] px-6 font-semibold text-[var(--color-signal-ink)] transition-all hover:shadow-[var(--shadow-glow)]"
            >
              Generate yours
              <ArrowDown className="h-4 w-4" />
            </a>
            <a
              href="#what-is-mcp"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-[var(--color-line)] px-6 font-medium text-[var(--color-ink)] hover:border-[var(--color-signal-dim)]"
            >
              What is MCP?
            </a>
          </div>
          <dl className="mt-10 flex gap-8">
            {[
              ["3", "input formats"],
              ["100%", "typed & validated"],
              ["0", "boilerplate to write"],
            ].map(([stat, label]) => (
              <div key={label}>
                <dt className="font-mono text-2xl font-semibold text-[var(--color-signal)]">
                  {stat}
                </dt>
                <dd className="mt-1 text-xs text-[var(--color-faint)]">
                  {label}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="animate-[rise_0.6s_cubic-bezier(0.2,0.7,0.2,1)_0.1s_both]">
          <DemoLoop />
        </div>
      </div>
    </section>
  );
}
