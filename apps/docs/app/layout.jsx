import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";
import "./globals.css";

export const metadata = {
  title: {
    default: "mcpgen",
    template: "%s — mcpgen",
  },
  description:
    "Turn an OpenAPI spec, GraphQL schema, or code repo into a working, typed, deployable MCP server.",
};

const REPO = "https://github.com/MobsLInep/mcpgen";

const Logo = () => (
  <span className="mcpgen-logo">
    <svg width="24" height="24" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        rx="7"
        stroke="var(--mcpgen-mint)"
        strokeWidth="2"
      />
      <path
        d="M9 21V11l4.5 6 4.5-6v10"
        stroke="var(--mcpgen-mint)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23" cy="20" r="2.1" fill="var(--mcpgen-mint)" />
    </svg>
    <span>
      mcpgen<span style={{ opacity: 0.45, fontWeight: 500 }}> docs</span>
    </span>
  </span>
);

const navbar = <Navbar logo={<Logo />} projectLink={REPO} />;

const footer = (
  <Footer>
    MIT {new Date().getFullYear()} © mcpgen contributors. Built with Nextra.
  </Footer>
);

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <Head />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase={`${REPO}/tree/main/apps/docs`}
          editLink="Edit this page on GitHub"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
