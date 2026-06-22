import { createServer, type Server } from "node:http";
import { CORE_VERSION } from "@mcpgen/core";

/**
 * Phase 0 placeholder API. Returns a static health payload. The real service
 * (generate endpoints the web UI calls) lands in Phase 3.
 */
export function createApiServer(): Server {
  return createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        service: "mcpgen-api",
        status: "ok",
        phase: 0,
        core: CORE_VERSION,
      }),
    );
  });
}

// Start the server only when run directly, e.g. `node dist/index.js`.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3001);
  createApiServer().listen(port, () => {
    process.stdout.write(`mcpgen-api listening on http://localhost:${port}\n`);
  });
}
