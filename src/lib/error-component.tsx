import type { ReactNode } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";

const FALLBACK_MESSAGE = "Ocorreu um erro inesperado. Tente recarregar a página.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

function Shell({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink px-6 text-center text-cream">
      <h1 className="font-display text-5xl tracking-wide uppercase">{title}</h1>
      {children}
      <Link
        to="/"
        className="inline-flex min-h-12 items-center justify-center bg-gold px-6 py-3 font-display text-xl tracking-widest text-ink uppercase"
      >
        Voltar para o início
      </Link>
    </main>
  );
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <Shell title="Algo deu errado">
      <p className="max-w-md text-sm text-pretty text-mist">{errorMessage(error)}</p>
    </Shell>
  );
}

export function NotFoundPage() {
  return (
    <Shell title="Página não encontrada">
      <p className="max-w-md text-sm text-pretty text-mist">
        Esse endereço não existe. Volte para a página da barbearia.
      </p>
    </Shell>
  );
}
