import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "mcpgen — turn any API into an MCP server",
  description:
    "Paste an OpenAPI spec or GraphQL schema and get a typed, secure, verified Model Context Protocol server you can download and run.",
};

export const viewport: Viewport = {
  themeColor: "#0b0f12",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
