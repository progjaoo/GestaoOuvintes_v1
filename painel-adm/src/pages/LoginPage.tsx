import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Headphones,
  LoaderCircle,
  LockKeyhole,
  RadioTower,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/services/api";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import logoRadio88 from "@/assets/logo-radio88.svg";
import { usePageTitle } from "@/hooks/usePageTitle";

export function LoginPage() {
  usePageTitle("Login");
  const { bootstrapAdmin, isAuthenticated, login } = useAuth();
  const [mode, setMode] = useState<"login" | "bootstrap">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminName, setAdminName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkingBootstrap, setCheckingBootstrap] = useState(true);
  const [canBootstrap, setCanBootstrap] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let active = true;

    api
      .getBootstrapStatus()
      .then(({ canBootstrap: isAvailable }) => {
        if (active) setCanBootstrap(isAvailable);
      })
      .catch(() => {
        if (active) setCanBootstrap(false);
      })
      .finally(() => {
        if (active) setCheckingBootstrap(false);
      });

    return () => {
      active = false;
    };
  }, []);

  if (isAuthenticated) {
    return <Navigate to="/ouvintes/cadastros" replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (username.trim().length < 3 || password.length < 8) {
      setError("Informe usuário e senha válidos.");
      return;
    }

    setSubmitting(true);
    try {
      await login(username, password);
      toast.success("Acesso autorizado.");
      const from =
        (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ??
        "/ouvintes/cadastros";
      navigate(from, { replace: true });
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Não foi possível entrar no painel.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBootstrapSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");

    if (adminName.trim().length < 2 || username.trim().length < 3) {
      setError("Informe nome e usuário válidos.");
      return;
    }

    if (password.length < 12) {
      setError("A senha precisa ter pelo menos 12 caracteres.");
      return;
    }

    if (password !== confirmPassword) {
      setError("A confirmação de senha não confere.");
      return;
    }

    setSubmitting(true);
    try {
      await bootstrapAdmin({
        name: adminName,
        username,
        password,
      });
      toast.success("Administrador criado.");
      navigate("/ouvintes/cadastros", { replace: true });
    } catch (requestError) {
      const message =
        requestError instanceof ApiError
          ? requestError.message
          : "Não foi possível criar o administrador.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const isBootstrapMode = mode === "bootstrap";

  return (
    <main className="grid min-h-screen bg-genesis-bg lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden border-r border-genesis-border bg-genesis-surface p-12 text-genesis-text lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-genesis-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-genesis-secondary/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center rounded-xl bg-genesis-text">
            <img src={logoRadio88} alt="Rádio 88 FM" className="h-10 w-10" />
          </div>
          <div>
            <p className="font-display font-semibold uppercase tracking-[0.2em]">
              Sistema de Gestão de Ouvintes
            </p>
            <p className="text-sm text-genesis-muted">Rádio 88 FM</p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-md border border-genesis-border bg-indigo-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-genesis-primary">
            <RadioTower className="h-4 w-4" />
            Base de ouvintes
          </span>
          <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05]">
            Conheça melhor quem acompanha a 88.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-genesis-muted">
            Consulte cadastros, acompanhe campanhas e gere relatórios operacionais
            com acesso controlado.
          </p>
        </div>

        <p className="relative text-xs text-genesis-muted">
          Ambiente administrativo. O acesso e as exportações são auditados.
        </p>
      </section>

      <section className="flex min-h-screen items-center justify-center p-5 sm:p-8">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-genesis-text">
              <img src={logoRadio88} alt="Rádio 88 FM" className="h-9 w-9" />
            </div>
            <div>
              <p className="font-display text-sm font-semibold text-genesis-text">
                Sistema de Gestão de Ouvintes
              </p>
              <p className="text-xs text-genesis-muted">Painel administrativo</p>
            </div>
          </div>

          <div className="rounded-xl border border-genesis-border bg-genesis-surface p-6 shadow-panel sm:p-8">
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-indigo-50 text-genesis-primary">
              <Headphones className="h-6 w-6" />
            </div>
            <h2 className="mt-5 font-display text-3xl font-semibold text-genesis-text">
              {isBootstrapMode ? "Crie o primeiro acesso" : "Acesse sua conta"}
            </h2>


            <form
              className="mt-7 space-y-5"
              onSubmit={isBootstrapMode ? handleBootstrapSubmit : handleSubmit}
            >
              {isBootstrapMode && (
                <Field label="Nome" htmlFor="adminName">
                  <Input
                    id="adminName"
                    name="adminName"
                    autoComplete="name"
                    value={adminName}
                    onChange={(event) => setAdminName(event.target.value)}
                    placeholder="Nome do administrador"
                    disabled={submitting}
                  />
                </Field>
              )}

              <Field label="Usuário" htmlFor="username">
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Seu usuário"
                  disabled={submitting}
                />
              </Field>

              <Field label="Senha" htmlFor="password">
                <div className="relative">
                  <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                    autoComplete={isBootstrapMode ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                    placeholder={isBootstrapMode ? "Mínimo de 12 caracteres" : "Sua senha"}
                  className="pr-12"
                  disabled={submitting}
                />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute inset-y-0 right-0 grid w-12 place-items-center text-genesis-muted hover:text-genesis-text"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </Field>

              {isBootstrapMode && (
                <Field label="Confirmar senha" htmlFor="confirmPassword">
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repita a senha"
                    disabled={submitting}
                  />
                </Field>
              )}

              {error && (
                <div
                  role="alert"
                  className="flex gap-3 rounded-lg border border-red-100 bg-red-50 p-3 text-sm font-semibold text-genesis-error"
                >
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {submitting
                  ? isBootstrapMode
                    ? "Criando..."
                    : "Entrando..."
                  : isBootstrapMode
                    ? "Criar e entrar"
                    : "Entrar no painel"}
              </Button>
            </form>

            {canBootstrap && (
              <div className="mt-5 border-t border-genesis-border pt-5">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={checkingBootstrap || submitting}
                  onClick={() => {
                    setError("");
                    setMode((current) => (current === "login" ? "bootstrap" : "login"));
                  }}
                >
                  {isBootstrapMode ? (
                    <>
                      <ArrowLeft className="h-4 w-4" />
                      Voltar ao login
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4" />
                      Criar primeiro acesso
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
