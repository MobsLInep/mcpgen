import { SiteHeader } from "@/components/site/header";
import { Hero } from "@/components/site/hero";
import { WhatIsMcp } from "@/components/site/what-is-mcp";
import { SiteFooter } from "@/components/site/footer";
import { Generator } from "@/components/generator/generator";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <WhatIsMcp />

        <section
          id="generate"
          className="mx-auto max-w-4xl scroll-mt-20 px-5 py-12"
        >
          <div className="mb-8 text-center">
            <p className="eyebrow">Generate</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Paste your API. Get an MCP server.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[var(--color-muted)]">
              Four steps: detect the operations, review and tweak them, choose a
              transport, and watch it generate and verify live.
            </p>
          </div>
          <Generator />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
