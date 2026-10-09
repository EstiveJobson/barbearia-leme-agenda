import { useState, type FormEvent } from "react";
import { submitPanelLogin } from "@/lib/painel/painel.functions";

export function PanelLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await submitPanelLogin({ data: { password } });
      if (!result.ok) {
        setError(result.message);
        setPending(false);
        return;
      }
      window.location.assign("/painel");
    } catch {
      setError("Não foi possível entrar. Confira a senha.");
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-x-hidden px-5 pt-10 pb-6">
      <p className="text-xs font-medium tracking-widest text-gold uppercase">Barbearia Leme</p>
      <h1 className="mt-2 font-display text-5xl leading-none uppercase">Painel</h1>
      <p className="mt-3 text-pretty text-mist">Entre com a senha da casa para ver a agenda.</p>
      <form onSubmit={(event) => void onSubmit(event)} className="mt-auto grid gap-3 pb-4">
        <label className="block">
          <span className="text-xs tracking-widest text-mist uppercase">Senha</span>
          <input
            required
            type="password"
            name="senha"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 min-h-12 w-full border border-line bg-panel-2 px-4 py-3 text-cream"
          />
        </label>
        {error && <p className="text-sm text-gold">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 w-full bg-gold px-5 font-display text-xl tracking-widest text-ink uppercase disabled:opacity-70"
        >
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
