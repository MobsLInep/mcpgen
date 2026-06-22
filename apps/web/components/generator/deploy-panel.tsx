"use client";

import { Cloud, Container, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const TARGETS = [
  {
    icon: Container,
    name: "Docker",
    blurb: "A hardened multi-stage image, ready for any container host.",
  },
  {
    icon: Cloud,
    name: "Cloudflare Workers",
    blurb: "Deploy the Streamable-HTTP transport to the edge in one command.",
  },
  {
    icon: Server,
    name: "Fly.io / Render",
    blurb: "Push the generated server to a managed Node host.",
  },
];

/**
 * Deploy targets land in Phase 6. This panel previews them so the result page
 * tells the whole story; the buttons are intentionally disabled for now.
 */
export function DeployPanel() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="eyebrow">Deploy</p>
        <Badge variant="violet">coming in Phase 6</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {TARGETS.map((t) => (
          <div
            key={t.name}
            className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)]/40 p-4"
          >
            <t.icon className="h-5 w-5 text-[var(--color-violet)]" />
            <p className="mt-2 text-sm font-medium">{t.name}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-faint)]">
              {t.blurb}
            </p>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--color-faint)]">
        For now, download the project and run it locally — the README includes
        copy-paste deploy instructions.
      </p>
    </div>
  );
}
