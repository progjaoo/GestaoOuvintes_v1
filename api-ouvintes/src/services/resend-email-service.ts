import { env } from "../config/env.js";

export type IdentityEmailKind = "invite" | "password_reset" | "email_verification";

export interface IdentityEmailInput {
  kind: IdentityEmailKind;
  to: string;
  name: string;
  token: string;
  idempotencyKey: string;
}

export type EmailDeliveryResult =
  | { status: "sent" }
  | { status: "not_configured" }
  | { status: "failed" | "uncertain"; code: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]!);
}

export async function sendIdentityEmail(
  input: IdentityEmailInput,
  fetcher: typeof fetch = fetch,
): Promise<EmailDeliveryResult> {
  if (!env.resendConfigured || !env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL || !env.ADMIN_APP_BASE_URL) {
    return { status: "not_configured" };
  }

  const actionPath = input.kind === "email_verification" ? "/confirmar-email" : "/definir-senha";
  const url = new URL(actionPath, env.ADMIN_APP_BASE_URL);
  url.hash = new URLSearchParams({ token: input.token }).toString();
  const action = input.kind === "invite"
    ? "Ative seu acesso ao Gestao de Ouvintes"
    : input.kind === "password_reset"
      ? "Redefina sua senha do Gestao de Ouvintes"
      : "Confirme seu e-mail do Gestao de Ouvintes";
  const expiry = input.kind === "invite" ? "24 horas" : "30 minutos";
  const safeName = escapeHtml(input.name);
  const safeUrl = escapeHtml(url.toString());
  const text = `${action}. Acesse o link para continuar: ${url.toString()} Este link expira em ${expiry}.`;
  const html = `<p>Ola, ${safeName}.</p><p>${action}.</p><p><a href="${safeUrl}">Continuar com seguranca</a></p><p>Se voce nao solicitou esta acao, ignore esta mensagem. O link expira em ${expiry} e pode ser usado uma unica vez.</p>`;

  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL,
        to: [input.to],
        subject: action,
        text,
        html,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (response.ok) return { status: "sent" };
    return { status: "failed", code: `http_${response.status}` };
  } catch (error) {
    const code = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network_error";
    return { status: code === "timeout" ? "uncertain" : "failed", code };
  }
}
