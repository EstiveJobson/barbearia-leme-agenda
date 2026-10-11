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

export const TEST_PUSH_RATE_LIMIT = "Muitos avisos de teste. Tente de novo em alguns minutos.";

export const TEST_PUSH_NONE =
  'Nenhum aparelho com avisos ativados. Toque em "Ativar avisos" primeiro.';

export const TEST_PUSH_TITLE = "Aviso de teste";

export const TEST_PUSH_BODY = "Se você está vendo isto, os avisos de agendamento estão funcionando.";

export function testPushSentMessage(count: number): string {
  return `Aviso enviado para ${count} aparelho(s).`;
}
