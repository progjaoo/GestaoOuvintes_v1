import type {
  InstitutionalBannerActionType,
  InstitutionalBannerInput,
} from "@/types/api";

export function resolveInstitutionalBannerActionType(
  actionType: InstitutionalBannerActionType | undefined,
  destinationUrl: string | null | undefined,
): InstitutionalBannerActionType {
  return actionType ?? (destinationUrl ? "external_url" : "none");
}

export function buildInstitutionalBannerAction(
  actionType: InstitutionalBannerActionType,
  destinationUrl: string,
  openInNewTab: boolean,
): Pick<
  InstitutionalBannerInput,
  "actionType" | "destinationUrl" | "openInNewTab"
> {
  if (actionType !== "external_url") {
    return {
      actionType,
      destinationUrl: null,
      openInNewTab: false,
    };
  }

  const normalizedUrl = destinationUrl.trim();
  if (!normalizedUrl) {
    throw new Error("Informe o link de destino para a ação externa.");
  }

  return {
    actionType,
    destinationUrl: normalizedUrl,
    openInNewTab,
  };
}

export const institutionalBannerActionLabels: Record<
  InstitutionalBannerActionType,
  string
> = {
  none: "Sem ação",
  external_url: "Abrir link externo",
  listener_registration_modal: "Abrir modal de cadastro/sorteio",
};
