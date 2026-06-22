// Fastify server fixture for the mcpgen code parser. Not executed — parsed.
import Fastify from "fastify";

const fastify = Fastify();

fastify.get("/ping", async () => {
  return { pong: true };
});

fastify.post("/items", async (request) => {
  return request.body;
});

fastify.get("/items/:itemId", async (request) => {
  return { id: (request.params as { itemId: string }).itemId };
});

// Object/route form.
fastify.route({
  method: "DELETE",
  url: "/items/:itemId",
  handler: async (_request, reply) => {
    reply.code(204).send();
  },
});

export default fastify;
