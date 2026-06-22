import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";

export const metadata = {
  title: {
    default: "mcpgen",
    template: "%s — mcpgen",
  },
  description:
    "Turn an OpenAPI spec, GraphQL schema, or code repo into a working, typed, deployable MCP server.",
};

const REPO = "https://github.com/MobsLInep/mcpgen";

const navbar = (
  <Navbar
    logo={
      <span style={{ fontWeight: 700, letterSpacing: "-0.02em" }}>
        mcpgen<span style={{ opacity: 0.5 }}> · docs</span>
      </span>
    }
    projectLink={REPO}
  />
);

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
