/**
 * @fileoverview Derive the "connect to a client" config blobs the result page
 * offers as copy buttons. Mirrors core's `connectSectionDoc` in `assemble.ts`
 * (Claude Desktop / Cursor use `mcpServers`; VS Code uses `servers`).
 */
import type { AuthMode, Transport } from "./protocol.js";

function envFor(auth: AuthMode): Record<string, string> {
  switch (auth) {
    case "apikey":
      return { MCPGEN_API_KEY: "<your-credential>" };
    case "oauth":
      return { MCPGEN_BEARER_TOKEN: "<your-credential>" };
    default:
      return {};
  }
}

/** Build the Claude Desktop / Cursor config object for a generated server. */
export function claudeConfig(
  serverName: string,
  transport: Transport,
  auth: AuthMode,
): unknown {
  const env = envFor(auth);
  const entry =
    transport === "http"
      ? {
          type: "http",
          url: "http://localhost:3000/mcp",
          ...(Object.keys(env).length > 0 ? { env } : {}),
        }
      : {
          command: "node",
          args: [`/ABSOLUTE/PATH/TO/${serverName}/dist/server.js`],
          ...(Object.keys(env).length > 0 ? { env } : {}),
        };
  return { mcpServers: { [serverName]: entry } };
}
