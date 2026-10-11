/** Where an unauthenticated or already-authenticated panel visit should go. */
export function panelLoginRedirect(hasSession: boolean, pathname: string): "/painel/entrar" | "/painel" | null {
  const onLogin = pathname === "/painel/entrar";
  const onPanel = pathname === "/painel" || pathname.startsWith("/painel/");
  if (!onPanel) return null;
  if (!hasSession && !onLogin) return "/painel/entrar";
  if (hasSession && onLogin) return "/painel";
  return null;
}

/** Wrong shop and wrong password share this message. */
export const LOGIN_INVALID_MESSAGE = "Senha ou loja incorreta.";

/** Panel copy and the JSON body of the push endpoints while demo mode is on for that shop. */
export const DEMO_PUSH_DISABLED = "Avisos desativados na demonstração.";
