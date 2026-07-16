import { Link } from "react-router-dom";
import { ArrowLeft, Radio } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div>
        <Radio className="mx-auto h-12 w-12 text-genesis-primary" />
        <p className="mt-5 font-display text-6xl font-semibold text-genesis-text">404</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-genesis-text">
          Página não encontrada
        </h1>
        <p className="mt-2 text-genesis-muted">
          O endereço informado não existe neste painel.
        </p>
        <Link to="/ouvintes/cadastros" className="mt-6 inline-block">
          <Button>
            <ArrowLeft className="h-4 w-4" />
            Voltar aos cadastros
          </Button>
        </Link>
      </div>
    </main>
  );
}
