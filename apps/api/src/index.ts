/**
 * @fileoverview Entry point for the mcpgen API service. The server itself lives
 * in `server.ts`; this file only wires it to a port when run directly.
 */
import { pathToFileURL } from "node:url";
import { createApiServer } from "./server.js";

export { createApiServer } from "./server.js";
export type { ApiServerOptions } from "./server.js";
export * from "./protocol.js";

// Start the server only when run directly (`node dist/index.js` or `tsx src`).
// `pathToFileURL` handles paths with spaces/encoding the naive `file://` cat
// does not.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT ?? 3001);
  createApiServer().listen(port, () => {
    process.stdout.write(
      `mcpgen-api listening on http://localhost:${port}` +
        (process.env.MCPGEN_FAKE === "1" ? " (fake runner)" : "") +
        "\n",
    );
  });
}
