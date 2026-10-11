import { useEffect, useState } from "react";
import { useDemoMode } from "@/components/demo-banner";
import { fetchPushSetup, savePushSubscription } from "@/lib/painel/painel.functions";
import { DEMO_PUSH_DISABLED } from "@/lib/painel/gate";

const PANEL_SW = "/painel/sw.js";
const PANEL_SCOPE = "/painel/";

async function retireRootPanelWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations.map(async (registration) => {
      const script =
        registration.active?.scriptURL ?? registration.waiting?.scriptURL ?? registration.installing?.scriptURL ?? "";
      if (script.includes("/painel-sw.js")) await registration.unregister();
    }),
  );
}

/** Panel worker only. Drops a leftover root `/painel-sw.js` registration. */
export async function panelPushSubscription(): Promise<PushSubscription | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  await retireRootPanelWorker();
  const registration = await navigator.serviceWorker.register(PANEL_SW, { scope: PANEL_SCOPE });
  return registration.pushManager.getSubscription();
}

function urlBase64ToUint8Array(value: string): Uint8Array {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function PushNotices() {
  const demo = useDemoMode();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void retireRootPanelWorker().catch(() => undefined);
    if (demo) return;
    void fetchPushSetup().then(async (result) => {
      if (cancel || !("ok" in result) || !result.ok || !result.enabled) return;
      setPublicKey(result.publicKey);
      const existing = await panelPushSubscription();
      if (!cancel && existing) setActive(true);
    }).catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [demo]);

  if (demo) {
    return <p className="text-pretty text-sm text-mist">{DEMO_PUSH_DISABLED}</p>;
  }

  if (!publicKey) return null;

  async function activate() {
    if (pending || active) return;
    setPending(true);
    setError(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
        setError("Este aparelho não recebe avisos.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("O navegador bloqueou os avisos.");
        return;
      }
      const registration = await navigator.serviceWorker.register(PANEL_SW, { scope: PANEL_SCOPE });
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey ?? "") as BufferSource,
      });
      const keys = subscription.toJSON().keys;
      const saved = await savePushSubscription({
        data: {
          endpoint: subscription.endpoint,
          p256dh: keys?.p256dh ?? "",
          auth: keys?.auth ?? "",
        },
      });
      if (!("ok" in saved) || !saved.ok) {
        setError("message" in saved && saved.message ? saved.message : "Não foi possível ativar os avisos.");
        return;
      }
      setActive(true);
    } catch {
      setError("Não foi possível ativar os avisos.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => void activate()}
        disabled={pending || active}
        className="min-h-12 w-full border border-gold px-4 text-sm tracking-wide text-gold uppercase disabled:opacity-70"
      >
        {active ? "Avisos ativos" : pending ? "Ativando…" : "Ativar avisos"}
      </button>
      <p className="text-pretty text-sm text-mist">
        No Android, os avisos funcionam na hora. No iPhone, só funciona com o painel adicionado à tela de início, no iOS
        16.4 ou posterior.
      </p>
      {error && <p className="text-sm text-gold">{error}</p>}
    </div>
  );
}
