import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { api, ApiError } from "@/services/api";
import { usePageTitle } from "@/hooks/usePageTitle";

export function IdentityActionPage({ action }: { action: "password" | "email" }) {
  usePageTitle(action === "email" ? "Confirmar e-mail" : "Definir senha");
  const [searchParams] = useSearchParams();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? searchParams.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (window.location.hash.includes("token=")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!token) { setError("Este link está incompleto. Solicite um novo pelo painel."); return; }
    if (action === "password" && (password.length < 12 || password !== confirmation)) {
      setError(password.length < 12 ? "Use uma senha com pelo menos 12 caracteres." : "As senhas não conferem.");
      return;
    }
    setSubmitting(true);
    try {
      await api.consumeIdentityToken(token, action === "password" ? password : undefined);
      toast.success(action === "email" ? "E-mail confirmado." : "Senha definida. Entre com sua nova senha.");
      window.location.assign("/login");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "O link não pôde ser validado.");
    } finally { setSubmitting(false); }
  };

  return <main className="grid min-h-screen place-items-center bg-genesis-bg p-4 sm:p-8">
    <section className="w-full max-w-lg rounded-xl border border-genesis-border bg-genesis-surface p-6 shadow-panel sm:p-9">
      <div className="grid h-12 w-12 place-items-center rounded-lg bg-accent text-genesis-primary">{action === "email" ? <CheckCircle2 className="h-6 w-6" /> : <LockKeyhole className="h-6 w-6" />}</div>
      <h1 className="mt-5 font-display text-3xl font-semibold text-genesis-text">{action === "email" ? "Confirmar e-mail" : "Ativar acesso ou redefinir senha"}</h1>
      <p className="mt-2 text-sm leading-6 text-genesis-muted">{action === "email" ? "Confirme que você controla o endereço associado à sua conta." : "Escolha uma senha forte. O link é de uso único e expira em até 24 horas para convites ou 30 minutos para recuperação."}</p>
      <form onSubmit={submit} className="mt-7 space-y-5">
        {action === "password" && <>
          <Field label="Nova senha" htmlFor="newPassword" hint="Mínimo de 12 caracteres."><Input id="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={submitting} /></Field>
          <Field label="Confirmar nova senha" htmlFor="confirmPassword"><Input id="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={submitting} /></Field>
        </>}
        {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-genesis-error">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting || !token}>{submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}{submitting ? "Validando…" : action === "email" ? "Confirmar e-mail" : "Salvar senha"}</Button>
      </form>
      <p className="mt-5 text-sm text-genesis-muted"><Link to="/login" className="font-semibold text-genesis-primary hover:underline">Voltar ao login</Link></p>
    </section>
  </main>;
}
