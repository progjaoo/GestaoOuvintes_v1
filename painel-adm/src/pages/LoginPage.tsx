import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Headphones, LoaderCircle, LockKeyhole, RadioTower } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import logoRadio88 from "@/assets/logo-radio88.svg";
import { usePageTitle } from "@/hooks/usePageTitle";

export function LoginPage() {
  usePageTitle("Acesso Administrativo");
  const { isAuthenticated, login } = useAuth();
  const [mode, setMode] = useState<"login" | "recovery">("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (identifier.trim().length < 3 || password.length < 8) {
      setError("Informe seu e-mail ou usuário e a senha.");
      return;
    }
    setSubmitting(true);
    try {
      await login(identifier.trim(), password);
      toast.success("Acesso autorizado.");
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
      navigate(from ?? "/", { replace: true });
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Não foi possível entrar no painel.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecovery = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api.requestPasswordReset(email.trim());
      toast.success(result.message);
      setMode("login");
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Não foi possível processar a solicitação.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen bg-genesis-bg lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden border-r border-genesis-border bg-genesis-surface p-12 text-genesis-text lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-genesis-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-genesis-secondary/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-xl bg-genesis-text"><img src={logoRadio88} alt="Rádio 88 FM" className="h-10 w-10" /></div>
          <div><p className="font-display font-semibold uppercase tracking-[0.2em]">Sistema de Gestão de Ouvintes</p><p className="text-sm text-genesis-muted">Rádio 88 FM</p></div>
        </div>
        <div className="relative max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-md border border-genesis-border bg-accent px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-genesis-primary"><RadioTower className="h-4 w-4" /> Acesso interno</span>
          <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05]">Uma equipe alinhada mantém a 88 em movimento.</h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-genesis-muted">Entre com seu e-mail confirmado ou use temporariamente seu usuário legado.</p>
        </div>
        <p className="relative text-xs text-genesis-muted">Ambiente administrativo. O acesso e as alterações são auditados.</p>
      </section>

      <section className="flex min-h-screen items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><div className="grid h-12 w-12 place-items-center rounded-xl bg-genesis-text"><img src={logoRadio88} alt="Rádio 88 FM" className="h-9 w-9" /></div><div><p className="font-display text-sm font-semibold text-genesis-text">Sistema de Gestão de Ouvintes</p><p className="text-xs text-genesis-muted">Painel administrativo</p></div></div>
          <div className="rounded-xl border border-genesis-border bg-genesis-surface p-6 shadow-panel sm:p-8">
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-accent text-genesis-primary"><Headphones className="h-6 w-6" /></div>
            <h2 className="mt-5 font-display text-3xl font-semibold text-genesis-text">{mode === "login" ? "Acesse sua conta" : "Recuperar acesso"}</h2>
            <p className="mt-2 text-sm leading-6 text-genesis-muted">{mode === "login" ? "Use seu e-mail corporativo ou, durante a transição, seu usuário atual." : "Se o e-mail estiver vinculado a uma conta ativa, enviaremos um link de recuperação."}</p>

            <form className="mt-7 space-y-5" onSubmit={mode === "login" ? handleLogin : handleRecovery}>
              {mode === "login" ? <>
                <Field label="E-mail ou usuário" htmlFor="identifier"><Input id="identifier" name="identifier" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="nome@radio88fm.com.br ou usuário" disabled={submitting} /></Field>
                <Field label="Senha" htmlFor="password"><div className="relative"><Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" className="pr-12" disabled={submitting} /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-genesis-muted hover:text-genesis-text" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></div></Field>
              </> : <Field label="E-mail da conta" htmlFor="recoveryEmail"><Input id="recoveryEmail" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@radio88fm.com.br" disabled={submitting} /></Field>}

              {error && <div role="alert" className="flex gap-3 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-semibold text-genesis-error"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
              <Button type="submit" className="w-full" disabled={submitting}>{submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}{submitting ? "Aguarde…" : mode === "login" ? "Entrar no painel" : "Enviar instruções"}</Button>
            </form>
            <div className="mt-5 flex flex-col gap-2 border-t border-genesis-border pt-4 text-sm sm:flex-row sm:justify-between">
              {mode === "recovery" ? <button type="button" className="text-left font-semibold text-genesis-primary hover:underline" onClick={() => { setError(""); setMode("login"); }}>Voltar ao login</button> : <button type="button" className="text-left font-semibold text-genesis-primary hover:underline" onClick={() => { setError(""); setMode("recovery"); }}>Esqueci minha senha</button>}
              <span className="text-genesis-muted">Acesso interno somente por convite</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
