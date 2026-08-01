import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  LoaderCircle,
  MapPin,
  Phone,
  RotateCw,
  Trophy,
  UsersRound,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { formatPhone } from "@/lib/formatters";
import type { Campaign, SweepstakeDrawResponse } from "@/types/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

const DRAW_ANIMATION_DURATION_MS = 8_000;

type DrawPhase =
  | "checking"
  | "drawing"
  | "animating"
  | "winner"
  | "redrawing"
  | "error";

interface SweepstakeDrawDialogProps {
  open: boolean;
  campaign: Campaign;
  onOpenChange: (open: boolean) => void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Não foi possível realizar o sorteio. Tente novamente.";
}

export function SweepstakeDrawDialog({
  open,
  campaign,
  onOpenChange,
}: SweepstakeDrawDialogProps) {
  const [phase, setPhase] = useState<DrawPhase>("checking");
  const [draw, setDraw] = useState<SweepstakeDrawResponse | null>(null);
  const [displayedName, setDisplayedName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const timersRef = useRef<number[]>([]);
  const requestTokenRef = useRef("");

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const revealDraw = useCallback(
    (result: SweepstakeDrawResponse) => {
      clearTimers();
      setDraw(result);
      setErrorMessage("");

      const names = result.animationNames.length
        ? result.animationNames
        : [result.winner.name];

      if (prefersReducedMotion()) {
        setDisplayedName(result.winner.name);
        setPhase("winner");
        return;
      }

      setPhase("animating");
      setDisplayedName(names[0]!);
      const weights = names.map((_, index) => Math.pow(index + 1, 1.55));
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let elapsed = 0;

      names.slice(1).forEach((name, index) => {
        elapsed += (weights[index]! / totalWeight) * DRAW_ANIMATION_DURATION_MS;
        timersRef.current.push(
          window.setTimeout(() => setDisplayedName(name), elapsed),
        );
      });

      timersRef.current.push(
        window.setTimeout(() => {
          setDisplayedName(result.winner.name);
          setPhase("winner");
        }, DRAW_ANIMATION_DURATION_MS),
      );
    },
    [clearTimers],
  );

  const runInitialDraw = useCallback(async () => {
    setPhase("checking");
    setErrorMessage("");
    try {
      const status = await api.getSweepstakeStatus(campaign.id);
      if (status.currentDraw) {
        setDraw(status.currentDraw);
        setDisplayedName(status.currentDraw.winner.name);
        setPhase("winner");
        return;
      }
      if (!status.canDraw) {
        if (status.legacyUnlinkedCount > 0) {
          throw new Error("Existem cadastros antigos que precisam ser vinculados antes do sorteio.");
        }
        if (status.campaignStatus !== "closed") {
          throw new Error("Encerre a campanha antes de realizar o sorteio.");
        }
        throw new Error("Não existem participantes elegíveis para este sorteio.");
      }

      setPhase("drawing");
      requestTokenRef.current ||= crypto.randomUUID();
      const result = await api.drawSweepstake(
        campaign.id,
        requestTokenRef.current,
      );
      revealDraw(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : getErrorMessage(error));
      setPhase("error");
    }
  }, [campaign.id, revealDraw]);

  useEffect(() => {
    if (!open) return;
    requestTokenRef.current = crypto.randomUUID();
    const startTimer = window.setTimeout(() => void runInitialDraw(), 0);

    return () => {
      window.clearTimeout(startTimer);
      clearTimers();
    };
  }, [clearTimers, open, runInitialDraw]);

  const isBusy = ["checking", "drawing", "animating", "redrawing"].includes(phase);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isBusy) return;
    if (!nextOpen) {
      clearTimers();
      setDraw(null);
      setDisplayedName("");
      setErrorMessage("");
    }
    onOpenChange(nextOpen);
  };

  const handleRedraw = async () => {
    if (!draw || isBusy) return;
    const confirmed = window.confirm(
      "O resultado atual será preservado na auditoria e o vencedor não participará novamente. Deseja continuar?",
    );
    if (!confirmed) return;

    setPhase("redrawing");
    setErrorMessage("");
    try {
      const result = await api.redrawSweepstake(
        campaign.id,
        draw.drawId,
        crypto.randomUUID(),
      );
      revealDraw(result);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setPhase("error");
    }
  };

  const footer = phase === "winner" && draw ? (
    <>
      <Button variant="outline" onClick={handleRedraw}>
        <RotateCw className="h-4 w-4" />
        Sortear novamente
      </Button>
      <Button onClick={() => handleOpenChange(false)}>Fechar</Button>
    </>
  ) : phase === "error" ? (
    <>
      <Button variant="outline" onClick={() => handleOpenChange(false)}>
        Fechar
      </Button>
      <Button onClick={() => void runInitialDraw()}>Tentar novamente</Button>
    </>
  ) : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={`Sorteio: ${campaign.name}`}
      description="O vencedor é definido de forma segura pela API e o resultado fica registrado na auditoria."
      footer={footer}
      className="sm:max-w-xl"
    >
      {phase === "error" ? (
        <div role="alert" className="rounded-xl border border-red-100 bg-red-50 p-5 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-genesis-error" />
          <p className="mt-3 font-semibold text-genesis-text">Sorteio indisponível</p>
          <p className="mt-2 text-sm leading-6 text-genesis-muted">{errorMessage}</p>
        </div>
      ) : phase === "winner" && draw ? (
        <div aria-live="polite" className="space-y-5">
          <div className="rounded-xl bg-gradient-to-br from-indigo-50 to-blue-50 p-6 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-genesis-primary text-white shadow-sm">
              <Trophy className="h-7 w-7" />
            </div>
            <p className="mt-4 text-xs font-bold uppercase tracking-[0.2em] text-genesis-primary">
              Pessoa sorteada
            </p>
            <h3 className="mt-2 font-display text-2xl font-semibold text-genesis-text sm:text-3xl">
              {draw.winner.name}
            </h3>
            <p className="mt-2 text-sm text-genesis-muted">
              Resultado nº {draw.sequence} entre {draw.eligibleCount} participante{draw.eligibleCount === 1 ? "" : "s"}
            </p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-genesis-border p-4">
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-genesis-muted">
                <MapPin className="h-4 w-4 text-genesis-primary" /> Cidade
              </dt>
              <dd className="mt-2 font-semibold text-genesis-text">{draw.winner.city}</dd>
            </div>
            <div className="rounded-lg border border-genesis-border p-4">
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-genesis-muted">
                <MapPin className="h-4 w-4 text-genesis-primary" /> Bairro
              </dt>
              <dd className="mt-2 font-semibold text-genesis-text">{draw.winner.neighborhood}</dd>
            </div>
            <div className="rounded-lg border border-genesis-border p-4 sm:col-span-2">
              <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-genesis-muted">
                <Phone className="h-4 w-4 text-genesis-primary" /> Telefone
              </dt>
              <dd className="mt-2 font-semibold text-genesis-text">{formatPhone(draw.winner.phone)}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div aria-live="polite" className="flex min-h-64 flex-col items-center justify-center rounded-xl bg-genesis-bg px-6 py-10 text-center">
          {phase === "animating" ? (
            <>
              <UsersRound className="h-10 w-10 text-genesis-primary" />
              <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-genesis-muted">
                Sorteando entre os participantes
              </p>
              <p className="mt-3 min-h-10 font-display text-2xl font-semibold text-genesis-text transition-all duration-150 sm:text-3xl">
                {displayedName}
              </p>
            </>
          ) : (
            <>
              <LoaderCircle className="h-10 w-10 animate-spin text-genesis-primary motion-reduce:animate-none" />
              <p className="mt-5 font-semibold text-genesis-text">
                {phase === "checking" ? "Conferindo participantes..." : phase === "redrawing" ? "Preparando novo sorteio..." : "Registrando o sorteio..."}
              </p>
              <p className="mt-2 text-sm text-genesis-muted">Não feche esta janela.</p>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
