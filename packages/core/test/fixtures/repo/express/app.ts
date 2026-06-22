// Express app fixture for the mcpgen code parser. Not executed — parsed.
import express from "express";

const app = express();
const router = express.Router();

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

router.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});

router.post("/users", (req, res) => {
  res.status(201).json(req.body);
});

router.put("/users/:id", (req, res) => {
  res.json({ id: req.params.id });
});

router.delete("/users/:id", (_req, res) => {
  res.status(204).end();
});

app.use("/api", router);

export default app;
