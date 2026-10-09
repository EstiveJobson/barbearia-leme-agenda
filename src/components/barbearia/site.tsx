import { useEffect, useState } from "react";
import { Instagram, MapPin, Menu, Star, X } from "lucide-react";
import { shop } from "@/shop-config";
import { brl, generalWaLink, hoursLine } from "@/lib/schedule";
import { Booking, initialBooking, type BookingState } from "@/components/barbearia/booking";

const NAV = [
  { href: "#servicos", label: "Serviços" },
  { href: "#agendar", label: "Agendar" },
  { href: "#galeria", label: "Galeria" },
  { href: "#barbeiros", label: "Barbeiros" },
  { href: "#depoimentos", label: "Avaliações" },
  { href: "#local", label: "Local" },
];

function Wordmark({ name, compact }: { name: string; compact?: boolean }) {
  const parts = name.trim().split(/\s+/);
  const last = parts.pop() ?? name;
  const lead = parts.join(" ");
  if (compact) {
    return (
      <span className="font-display text-2xl leading-none tracking-wide uppercase">
        {lead ? `${lead} ` : ""}
        {last}
      </span>
    );
  }
  return (
    <h1 className="font-display leading-none uppercase">
      {lead && (
        <span className="block text-3xl tracking-widest text-cream md:text-5xl">{lead}</span>
      )}
      <span className="mt-1 block text-7xl text-cream md:text-8xl lg:text-9xl">{last}</span>
    </h1>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M20.5 3.5A11 11 0 0 0 2.1 16.8L1 23l6.4-1.1A11 11 0 0 0 12 22a11 11 0 0 0 8.5-18.5zM12 20.2a9.1 9.1 0 0 1-4.6-1.3l-.3-.2-3.8.7.7-3.7-.2-.3A9.2 9.2 0 1 1 12 20.2zm5-6.8c-.3-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.6.1a7.5 7.5 0 0 1-2.2-1.4 8.3 8.3 0 0 1-1.5-1.9c-.2-.3 0-.4.1-.6l.4-.5.2-.3a.5.5 0 0 0 0-.5c-.1-.1-.6-1.4-.8-1.9s-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.5 4 4 4 0 0 0 2.6.5 2.5 2.5 0 0 0 1.7-1.1 2 2 0 0 0 .1-1.2c-.1-.2-.3-.2-.6-.4z" />
    </svg>
  );
}

export function Site() {
  const [open, setOpen] = useState(false);
  const [booking, setBooking] = useState<BookingState>(initialBooking);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [hideWa, setHideWa] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open || lightbox !== null ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, lightbox]);

  useEffect(() => {
    const target = document.getElementById("agendar");
    if (!target) return;
    const small = window.matchMedia("(max-width: 767px)");
    const obs = new IntersectionObserver(
      ([entry]) => {
        setHideWa(small.matches && entry.isIntersecting);
      },
      { threshold: 0.12 },
    );
    const onChange = () => {
      if (!small.matches) setHideWa(false);
    };
    obs.observe(target);
    small.addEventListener("change", onChange);
    return () => {
      obs.disconnect();
      small.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") setLightbox((i) => (i === null ? i : (i + 1) % shop.gallery.length));
      if (e.key === "ArrowLeft")
        setLightbox((i) => (i === null ? i : (i - 1 + shop.gallery.length) % shop.gallery.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  function book(serviceId: string) {
    setBooking((s) => ({ ...s, serviceId, step: 2 }));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("agendar")?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }

  function closeAnd(href: string) {
    setOpen(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector(href)?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }

  const wa = generalWaLink();
  const mapSrc = `https://maps.google.com/maps?q=${encodeURIComponent(shop.mapQuery)}&z=16&hl=pt-BR&output=embed`;
  const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.mapQuery)}`;
  const shot = lightbox !== null ? shop.gallery[lightbox] : null;

  return (
    <div id="topo" className="min-h-dvh bg-ink text-cream">
      <header
        className="header-bar fixed inset-x-0 top-0 z-40"
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
          <a href="#topo" className="flex min-w-0 items-center gap-2 text-cream" aria-label={shop.name}>
            <span className="grid size-9 shrink-0 place-items-center border border-gold font-display text-xl text-gold">
              {shop.name.trim().slice(0, 1)}
            </span>
            <span className="truncate font-display text-2xl tracking-wide uppercase">{shop.name}</span>
          </a>
          <nav className="hidden items-center gap-5 lg:flex" aria-label="Seções">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="text-sm tracking-wide text-cream/90 uppercase">
                {item.label}
              </a>
            ))}
          </nav>
          <button
            type="button"
            className="grid size-11 place-items-center text-cream lg:hidden"
            aria-expanded={open}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
        {open && (
          <nav className="border-t border-line bg-ink px-5 py-4 lg:hidden" aria-label="Seções">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={(e) => {
                  e.preventDefault();
                  closeAnd(item.href);
                }}
                className="flex min-h-12 items-center border-b border-line font-display text-3xl tracking-wide uppercase"
              >
                {item.label}
              </a>
            ))}
          </nav>
        )}
      </header>

      <section className="relative flex min-h-dvh items-end">
        <img
          src={shop.hero}
          alt="Barbeiro em atendimento na cadeira"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="hero-shade absolute inset-0" />
        <div className="relative z-10 mx-auto w-full max-w-6xl px-5 pt-24 pb-12 md:pb-16">
          <p className="text-xs font-medium tracking-widest text-gold uppercase">{shop.cityLine}</p>
          <div className="mt-4">
            <Wordmark name={shop.name} />
          </div>
          <p className="mt-5 max-w-md font-display text-2xl tracking-wide text-cream uppercase md:text-3xl">
            {shop.tagline}
          </p>
          <p className="mt-3 max-w-lg text-pretty text-cream/80">{shop.intro}</p>
          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
            <a
              href="#agendar"
              className="inline-flex min-h-12 items-center justify-center bg-gold px-6 py-3 font-display text-xl tracking-widest text-ink uppercase"
            >
              Agende seu horário
            </a>
            <p className="text-sm tracking-wide text-cream/75 uppercase">{hoursLine()}</p>
          </div>
        </div>
      </section>

      <section id="servicos" className="scroll-mt-20 border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <p className="text-xs font-medium tracking-widest text-gold uppercase">A carta</p>
          <h2 className="mt-2 font-display text-5xl leading-none uppercase md:text-6xl">Serviços</h2>
          <ul className="mt-10 divide-y divide-line border-y border-line md:grid md:grid-cols-2 md:gap-x-12 md:divide-y-0 md:border-0">
            {shop.services.map((service, index) => (
              <li key={service.id} className="border-line py-5 md:border-b">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs tracking-widest text-mist tabular-nums">
                      {String(index + 1).padStart(2, "0")}
                    </p>
                    <h3 className="font-display text-4xl leading-none tracking-wide uppercase">{service.name}</h3>
                    <p className="mt-2 max-w-sm text-sm text-pretty text-mist">{service.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-3xl text-gold tabular-nums">{brl(service.price)}</p>
                    <p className="text-xs tracking-wide text-mist uppercase">{service.duration} min</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => book(service.id)}
                  className="mt-4 inline-flex min-h-11 items-center border border-gold px-4 font-display text-lg tracking-widest text-gold uppercase"
                >
                  Agendar
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Booking state={booking} setState={setBooking} />

      <section id="galeria" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <p className="text-xs font-medium tracking-widest text-gold uppercase">A casa</p>
          <h2 className="mt-2 font-display text-5xl leading-none uppercase md:text-6xl">Galeria</h2>
          <div className="mt-8 grid grid-cols-2 gap-2 md:grid-cols-3">
            {shop.gallery.map((photo, index) => (
              <button
                key={photo.src}
                type="button"
                onClick={() => setLightbox(index)}
                className="group relative overflow-hidden ratio-portrait"
              >
                <img
                  src={photo.src}
                  alt={photo.alt}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section id="barbeiros" className="scroll-mt-20 border-t border-line bg-panel">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <p className="text-xs font-medium tracking-widest text-gold uppercase">Quem atende</p>
          <h2 className="mt-2 font-display text-5xl leading-none uppercase md:text-6xl">Nossos barbeiros</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {shop.barbers.map((barber) => (
              <li key={barber.id} className="border border-line bg-ink">
                <img src={barber.photo} alt={barber.name} className="ratio-portrait w-full object-cover" />
                <div className="px-4 py-4">
                  <h3 className="font-display text-3xl leading-none tracking-wide uppercase">{barber.name}</h3>
                  <p className="mt-2 text-sm text-mist">{barber.specialty}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="depoimentos" className="scroll-mt-20 border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-16 md:py-24">
          <p className="text-xs font-medium tracking-widest text-gold uppercase">Quem senta</p>
          <h2 className="mt-2 font-display text-5xl leading-none uppercase md:text-6xl">Depoimentos</h2>
          <ul className="mt-8 grid gap-4 md:grid-cols-2">
            {shop.reviews.map((review) => (
              <li key={review.name} className="border border-line bg-panel p-5">
                <div className="flex gap-1 text-gold" aria-label="5 de 5 estrelas">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} className="size-4 fill-current" aria-hidden="true" />
                  ))}
                </div>
                <blockquote className="mt-4 text-pretty text-lg leading-relaxed text-cream">
                  “{review.text}”
                </blockquote>
                <p className="mt-4 text-sm tracking-wide text-mist uppercase">{review.name}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="local" className="scroll-mt-20 border-t border-line bg-panel">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="text-xs font-medium tracking-widest text-gold uppercase">Onde estamos</p>
            <h2 className="mt-2 font-display text-5xl leading-none uppercase md:text-6xl">
              Localização e horários
            </h2>
            <p className="mt-6 flex gap-2 text-cream">
              <MapPin className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
              <span>{shop.address}</span>
            </p>
            <a
              href={mapHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-11 items-center text-sm tracking-widest text-gold uppercase"
            >
              Abrir no mapa
            </a>
            <ul className="mt-8 divide-y divide-line border-y border-line">
              {shop.hours.map((row) => (
                <li key={row.day} className="flex items-baseline justify-between gap-4 py-3">
                  <span className="text-cream">{row.label}</span>
                  <span className="font-display text-xl tracking-wide text-gold tabular-nums">
                    {row.closed ? "Fechado" : `${row.open} – ${row.close}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-h-72 overflow-hidden border border-line">
            <iframe
              title={`Mapa — ${shop.name}`}
              src={mapSrc}
              className="map-frame h-full min-h-72 w-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-display text-3xl tracking-wide uppercase">{shop.name}</p>
            <p className="mt-2 max-w-sm text-sm text-mist">{shop.address}</p>
            <div className="mt-4 flex gap-3">
              <a
                href={`https://instagram.com/${shop.instagram.replace("@", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="grid size-11 place-items-center border border-line text-cream"
              >
                <Instagram className="size-5" />
              </a>
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
                className="grid size-11 place-items-center border border-line text-cream"
              >
                <WhatsAppIcon className="size-5" />
              </a>
            </div>
          </div>
          <div className="text-sm text-mist md:text-right">
            <p>
              © {shop.year} {shop.name}
            </p>
            <p className="mt-1 text-xs tracking-wide uppercase">Site de demonstração</p>
          </div>
        </div>
      </footer>

      <a
        href={wa}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="WhatsApp da barbearia"
        className={`fixed right-4 bottom-4 z-40 grid size-14 place-items-center bg-gold text-ink shadow-lg transition-opacity duration-300 ${
          open ? "hidden" : ""
        } ${hideWa ? "max-md:pointer-events-none max-md:opacity-0" : ""}`}
      >
        <WhatsAppIcon className="size-7" />
      </a>

      {shot && lightbox !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/95 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={shot.alt}
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 grid size-11 place-items-center text-cream"
            aria-label="Fechar"
            onClick={() => setLightbox(null)}
          >
            <X className="size-6" />
          </button>
          <button
            type="button"
            className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center font-display text-3xl text-cream"
            aria-label="Foto anterior"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox((lightbox - 1 + shop.gallery.length) % shop.gallery.length);
            }}
          >
            ‹
          </button>
          <img
            src={shot.src}
            alt={shot.alt}
            className="max-h-[82dvh] max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center font-display text-3xl text-cream"
            aria-label="Próxima foto"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox((lightbox + 1) % shop.gallery.length);
            }}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
