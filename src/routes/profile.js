import { Hono } from "hono";

const router = new Hono();

router.get("/", async (c) => c.json(await c.var.store.getProfile()));

router.put("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await c.var.store.saveProfile(body));
});

export default router;
