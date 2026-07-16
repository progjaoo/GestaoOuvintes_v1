import type { FastifyPluginAsync } from "fastify";
import { requireAdminRole, requireAuthentication } from "../plugins/auth.js";
import {
  registrationExportQuerySchema,
  registrationIdParamsSchema,
  registrationListQuerySchema,
} from "../schemas/registration.js";
import {
  auditExport,
  getListenerRegistration,
  getRegistrationsForExport,
  listListenerRegistrations,
} from "../services/registration-service.js";
import { createPagination } from "../lib/pagination.js";
import { createCsv, createXlsx } from "../services/export-service.js";

export const adminRegistrationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuthentication);

  app.get("/", async (request) => {
    const filters = registrationListQuerySchema.parse(request.query);
    const { rows, total } = await listListenerRegistrations(filters);
    return createPagination(rows, filters.page, filters.pageSize, total);
  });

  app.get(
    "/export",
    {
      preHandler: requireAdminRole,
    },
    async (request, reply) => {
      const { format, ...filters } = registrationExportQuerySchema.parse(request.query);
      const rows = await getRegistrationsForExport(filters);
      const date = new Date().toISOString().slice(0, 10);

      await auditExport({
        adminUserId: request.user.sub,
        campaignId: filters.campaignId,
        format,
        filters,
        rowCount: rows.length,
      });

      if (format === "csv") {
        return reply
          .type("text/csv; charset=utf-8")
          .header(
            "Content-Disposition",
            `attachment; filename="cadastros-radio88-${date}.csv"`,
          )
          .send(createCsv(rows));
      }

      return reply
        .type(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .header(
          "Content-Disposition",
          `attachment; filename="cadastros-radio88-${date}.xlsx"`,
        )
        .send(await createXlsx(rows));
    },
  );

  app.get("/:id", async (request) => {
    const { id } = registrationIdParamsSchema.parse(request.params);
    return getListenerRegistration(id);
  });
};
