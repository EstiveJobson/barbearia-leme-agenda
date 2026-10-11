self.addEventListener("push", (event) => {
  let title = "Painel Leme";
  let body = "Novo agendamento";
  let url = "/painel";
  try {
    const text = event.data && event.data.text();
    if (text) {
      body = text;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.title === "string" && parsed.title) title = parsed.title;
          if (typeof parsed.body === "string") body = parsed.body;
          if (typeof parsed.url === "string" && parsed.url.startsWith("/painel")) url = parsed.url;
        }
      } catch {
        // Booking notices are plain text. Keep that string as the body.
      }
    }
  } catch {
    body = "Novo agendamento";
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/painel/icon-192.png",
      badge: "/painel/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.includes("/painel") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow("/painel");
    }),
  );
});
