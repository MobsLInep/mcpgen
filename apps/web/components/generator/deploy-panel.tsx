"use client";

import { Cloud, Container, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const TARGETS = [
  {
    icon: Container,
    name: "Docker / Compose",
    blurb:
      "A hardened multi-stage image with a /healthz check, plus a docker-compose.yml.",
  },
  {
    icon: Server,
    name: "Fly.io",
    blurb: "fly.toml with the build, env, and health check wired — fly deploy.",
  },
  {
    icon: Cloud,
    name: "Render / Railway",
    blurb: "render.yaml Blueprint + railway.json, both probing /healthz.",
  },
];

/**
 * Phase 6 ships deploy targets inside every generated project. This panel
 * advertises what's in the download so the result page tells the whole story.
 */
export function DeployPanel() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="eyebrow">Deploy</p>
        <Badge variant="violet">in the download</Badge>
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
        Every generated project includes a Dockerfile, docker-compose.yml, and
        Fly/Render/Railway configs — the README has copy-paste deploy steps for
        each, plus TLS / CORS / DNS-rebinding hardening notes.
      </p>
    </div>
  );
}
