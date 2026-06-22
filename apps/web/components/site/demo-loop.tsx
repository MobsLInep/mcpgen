"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

/**
 * A self-contained, looping demo of the mcpgen flow — no video asset. It cycles
 * through "paste → detect → generate → verified" on a timer so the hero always
 * shows motion. Purely decorative (aria-hidden).
 */
const STEPS = [
  { label: "parse openapi.json", detail: "3 tools detected" },
  { label: "plan + synthesize", detail: "listPets · createPet · getPetById" },
  { label: "assemble project", detail: "11 files" },
  { label: "install · build · boot · smoke", detail: "verified ✓" },
];

export function DemoLoop() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActive((a) => (a + 1) % (STEPS.length + 1));
    }, 1100);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-canvas)]/80 shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] bg-[var(--color-surface)]/60 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-danger)]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-amber)]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-signal)]/70" />
        <span className="ml-2 font-mono text-xs text-[var(--color-faint)]">
          mcpgen
        </span>
      </div>
      <div className="space-y-2.5 p-5 font-mono text-sm">
        <p className="text-[var(--color-muted)]">
          <span className="text-[var(--color-signal)]">$</span> mcpgen generate
          petstore.json
          <span className="ml-0.5 inline-block w-2 animate-[blink_1.1s_step-end_infinite] bg-[var(--color-signal)] align-middle">
            &nbsp;
          </span>
        </p>
        {STEPS.map((s, i) => {
          const done = active > i;
          const running = active === i;
          const visible = active >= i;
          return (
            <div
              key={s.label}
              className="flex items-center gap-3 transition-opacity duration-300"
              style={{ opacity: visible ? 1 : 0.25 }}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                {done ? (
                  <Check className="h-4 w-4 text-[var(--color-signal)]" />
                ) : running ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--color-signal)]" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-line)]" />
                )}
              </span>
              <span className="text-[var(--color-ink)]">{s.label}</span>
              <span className="ml-auto text-xs text-[var(--color-faint)]">
                {done || running ? s.detail : ""}
              </span>
            </div>
          );
        })}
        <p
          className="pt-1 text-[var(--color-signal)] transition-opacity duration-300"
          style={{ opacity: active > STEPS.length - 1 ? 1 : 0 }}
        >
          ✓ server ready — download .zip or connect to Claude Desktop
        </p>
      </div>
    </div>
  );
}
