import { useRouterState } from "@tanstack/react-router";

export function useDemoMode(): boolean {
  return useRouterState({
    select: (state) =>
      state.matches.some((match) => {
        const data = match.loaderData as { demo?: boolean } | undefined;
        return data?.demo === true;
      }),
  });
}

/** Small fixed strip. Rendered only when the server says demo mode is on. */
export function DemoBanner() {
  const demo = useDemoMode();
  if (!demo) return null;
  return (
    <>
      <div className="h-7" aria-hidden="true" />
      <div className="fixed inset-x-0 top-0 z-[60] flex h-7 items-center justify-center border-b border-gold/40 bg-ink text-[11px] font-medium tracking-[0.22em] text-gold uppercase">
        Demonstração
      </div>
    </>
  );
}