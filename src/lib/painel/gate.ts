/** Where an unauthenticated or already-authenticated panel visit should go. */
export function panelLoginRedirect(hasSession: boolean, pathname: string): "/painel/entrar" | "/painel" | null {
  const onLogin = pathname === "/painel/entrar";
  const onPanel = pathname === "/painel" || pathname.startsWith("/painel/");
  if (!onPanel) return null;
  if (!hasSession && !onLogin) return "/painel/entrar";
  if (hasSession && onLogin) return "/painel";
  return null;
}
