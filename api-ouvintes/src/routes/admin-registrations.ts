import { hasGlobalPermission } from "../services/authorization-service.js";
import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../lib/errors.js";
import { requireAuthentication, requirePermission } from "../plugins/auth.js";
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
  const canRead = requirePermission("listener.read");
  const canExport = requirePermission("registration.export");

  app.get("/", { preHandler: canRead }, async (request) => {
    const filters = registrationListQuerySchema.parse(request.query);
    const canReadPhone = hasGlobalPermission(request.authz, "listener.phone.read");
    if (!canReadPhone && filters.hasPhone !== undefined) {
      throw new AppError(403, "PHONE_PERMISSION_REQUIRED", "Permissao para consultar telefone insuficiente.");
    }
    const { rows, total } = await listListenerRegistrations(filters, { canSearchPhone: canReadPhone });
    return createPagination(
      canReadPhone ? rows : rows.map((row) => ({ ...row, phone: null })),
      filters.page,
      filters.pageSize,
      total,
    );
  });

  app.get(
    "/export",
    {
      preHandler: canExport,
    },
    async (request, reply) => {
      const { format, ...filters } = registrationExportQuerySchema.parse(request.query);
      const canReadPhone = hasGlobalPermission(request.authz, "listener.phone.read");
      if (!canReadPhone && filters.hasPhone !== undefined) {
        throw new AppError(403, "PHONE_PERMISSION_REQUIRED", "Permissao para consultar telefone insuficiente.");
      }
      const rows = await getRegistrationsForExport(filters, {
        canSearchPhone: canReadPhone,
        canReadPhone,
      });
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

  app.get("/:id", { preHandler: canRead }, async (request) => {
    const { id } = registrationIdParamsSchema.parse(request.params);
    const registration = await getListenerRegistration(id);
    return hasGlobalPermission(request.authz, "listener.phone.read")
      ? registration
      : { ...registration, phone: null };
  });
};
