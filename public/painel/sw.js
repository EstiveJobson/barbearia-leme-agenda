self.addEventListener("push", (event) => {
  let body = "Novo agendamento";
  try {
    const text = event.data && event.data.text();
    if (text) body = text;
  } catch {
    body = "Novo agendamento";
  }
  event.waitUntil(
    self.registration.showNotification("Painel Leme", {
      body,
      icon: "/painel/icon-192.png",
      badge: "/painel/icon-192.png",
      data: { url: "/painel" },
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
