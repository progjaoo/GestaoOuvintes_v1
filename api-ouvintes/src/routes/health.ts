import type { FastifyPluginAsync } from "fastify";
import { pool } from "../database/client.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    service: "radio88-cadastros-api",
    timestamp: new Date().toISOString(),
  }));

  app.get("/ready", async (_request, reply) => {
    await pool.query("SELECT 1");
    return reply.send({
      status: "ready",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  });
};
