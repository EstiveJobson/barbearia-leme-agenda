import { shop as leme } from "@/shop-config";

export type CatalogBarber = {
  slug: string;
  name: string;
  specialty: string;
  photo: string | null;
};

export type CatalogService = {
  slug: string;
  name: string;
  description: string;
  price: number;
  duration: number;
};

export type CatalogHours = { weekday: number; start: string; end: string };

export type CatalogShop = {
  slug: string;
  name: string;
  timezone: string;
  tagline: string;
  intro: string;
  cityLine: string;
  seoDescription: string;
  whatsapp: string;
  instagram: string;
  address: string;
  mapQuery: string;
  slotMinutes: number;
  year: number;
  barbers: CatalogBarber[];
  services: CatalogService[];
  hours: CatalogHours[];
};

/** Barbearia Leme, copied from the public site config. */
export function lemeCatalog(): CatalogShop {
  return {
    slug: "barbearia-leme",
    name: leme.name,
    timezone: leme.timezone,
    tagline: leme.tagline,
    intro: leme.intro,
    cityLine: leme.cityLine,
    seoDescription: leme.seoDescription,
    whatsapp: leme.whatsapp,
    instagram: leme.instagram,
    address: leme.address,
    mapQuery: leme.mapQuery,
    slotMinutes: leme.slotMinutes,
    year: leme.year,
    barbers: leme.barbers.map((barber) => ({
      slug: barber.id,
      name: barber.name,
      specialty: barber.specialty,
      photo: barber.photo,
    })),
    services: leme.services.map((service) => ({
      slug: service.id,
      name: service.name,
      description: service.description,
      price: service.price,
      duration: service.duration,
    })),
    hours: leme.hours
      .filter((row) => !row.closed)
      .map((row) => ({ weekday: row.day, start: row.open, end: row.close })),
  };
}

/** Second shop used only to prove one shop cannot see the other's rows. */
export function testShopCatalog(): CatalogShop {
  return {
    slug: "barbearia-teste",
    name: "Barbearia Teste",
    timezone: "America/Manaus",
    tagline: "Loja fictícia para testes de isolamento",
    intro:
      "Não é uma barbearia real. Existe só para provar que os dados de uma loja não aparecem na outra.",
    cityLine: "Manaus — AM",
    seoDescription: "Loja de teste da demonstração. Não atende clientes.",
    whatsapp: "92000000000",
    instagram: "barbearia-teste-demo",
    address: "Rua das Palmeiras, 10 — Centro, Manaus — AM",
    mapQuery: "Manaus, Amazonas, Brasil",
    slotMinutes: 30,
    year: 2026,
    barbers: [
      { slug: "ana", name: "Ana Teste", specialty: "Corte de teste", photo: null },
      { slug: "bruno", name: "Bruno Teste", specialty: "Barba de teste", photo: null },
    ],
    services: [
      {
        slug: "corte",
        name: "Corte",
        description: "Corte simples usado só nos testes.",
        price: 30,
        duration: 30,
      },
      {
        slug: "barba",
        name: "Barba",
        description: "Barba usada só nos testes.",
        price: 20,
        duration: 20,
      },
      {
        slug: "combo",
        name: "Corte + Barba",
        description: "Combo usado só nos testes.",
        price: 45,
        duration: 50,
      },
    ],
    hours: [
      { weekday: 2, start: "10:00", end: "18:00" },
      { weekday: 3, start: "10:00", end: "18:00" },
      { weekday: 4, start: "10:00", end: "18:00" },
      { weekday: 5, start: "10:00", end: "18:00" },
      { weekday: 6, start: "09:00", end: "13:00" },
    ],
  };
}
