/**
 * Single source for the public Barbearia Leme site content.
 * Visible copy, prices, staff, and hours come from here.
 * The shop WhatsApp number is not stored here. It is seeded into shops.whatsapp
 * (see src/lib/agenda/catalog.ts) and links are built on the server from that row.
 */

export type Service = {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;
};

export type Barber = {
  id: string;
  name: string;
  specialty: string;
  photo: string;
};

export type DayHours =
  | { day: number; label: string; closed: true }
  | { day: number; label: string; closed: false; open: string; close: string };

export type Review = {
  name: string;
  text: string;
};

export type GalleryShot = {
  src: string;
  alt: string;
};

export type Shop = {
  name: string;
  tagline: string;
  intro: string;
  year: number;
  /** IANA timezone used for slot labels and for shops.timezone when seeding. */
  timezone: string;
  cityLine: string;
  seoDescription: string;
  instagram: string;
  address: string;
  mapQuery: string;
  /** Length of each agenda grid step, in minutes. */
  slotMinutes: number;
  hero: string;
  services: Service[];
  barbers: Barber[];
  hours: DayHours[];
  reviews: Review[];
  gallery: GalleryShot[];
};

const img = (id: string, w = 1400) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

export const shop: Shop = {
  name: "Barbearia Leme",
  tagline: "Estilo e tradição em cada corte",
  intro:
    "Cadeira marcada, navalha afiada e tempo só seu. No centro de Lauro de Freitas, sem fila e sem pressa.",
  year: 2026,
  timezone: "America/Bahia",
  cityLine: "Lauro de Freitas — BA",
  seoDescription:
    "Barbearia Leme, no Centro de Lauro de Freitas. Corte, barba e pigmentação com horário marcado pelo WhatsApp. Terça a sábado.",
  instagram: "barbearialeme",
  address: "Av. Santos Dumont, 450 — Centro, Lauro de Freitas — BA",
  mapQuery: "Av. Santos Dumont, 450, Centro, Lauro de Freitas, Bahia, Brasil",
  slotMinutes: 30,
  hero: img("photo-1503951914875-452162b0f3f1", 2000),
  services: [
    {
      id: "corte",
      name: "Corte",
      description: "Tesoura e máquina, com acabamento na navalha e alinhamento.",
      price: 45,
      duration: 40,
    },
    {
      id: "barba",
      name: "Barba",
      description: "Desenho, toalha quente e hidratação para fechar o visual.",
      price: 35,
      duration: 30,
    },
    {
      id: "combo",
      name: "Corte + Barba",
      description: "O ritual completo: cabelo, barba e finalização.",
      price: 75,
      duration: 70,
    },
    {
      id: "pigmentacao",
      name: "Pigmentação",
      description: "Disfarce de falhas e fios brancos, com efeito natural.",
      price: 40,
      duration: 30,
    },
    {
      id: "sobrancelha",
      name: "Sobrancelha",
      description: "Design masculino, limpo e proporcional ao rosto.",
      price: 20,
      duration: 15,
    },
    {
      id: "infantil",
      name: "Corte Infantil",
      description: "Corte com calma para crianças de até 12 anos.",
      price: 35,
      duration: 30,
    },
  ],
  barbers: [
    {
      id: "rafael",
      name: "Rafael Lima",
      specialty: "Degradê e corte clássico",
      photo: img("photo-1621605815971-fbc98d665033", 900),
    },
    {
      id: "diego",
      name: "Diego Santos",
      specialty: "Barba e pigmentação",
      photo: img("photo-1599351431202-1e0f0137899a", 900),
    },
    {
      id: "caio",
      name: "Caio Mendes",
      specialty: "Cortes modernos e infantil",
      photo: img("photo-1506794778202-cad84cf45f1d", 900),
    },
  ],
  hours: [
    { day: 0, label: "Domingo", closed: true },
    { day: 1, label: "Segunda", closed: true },
    { day: 2, label: "Terça", closed: false, open: "09:00", close: "19:00" },
    { day: 3, label: "Quarta", closed: false, open: "09:00", close: "19:00" },
    { day: 4, label: "Quinta", closed: false, open: "09:00", close: "19:00" },
    { day: 5, label: "Sexta", closed: false, open: "09:00", close: "20:00" },
    { day: 6, label: "Sábado", closed: false, open: "08:00", close: "18:00" },
  ],
  reviews: [
    {
      name: "Marcos Andrade",
      text: "O degradê do Rafael dura a semana inteira. Marco horário e sento na hora — sem aquela espera de barbearia cheia.",
    },
    {
      name: "Tiago Nascimento",
      text: "Barba com toalha quente e sem pressa. O Diego acerta o desenho do jeito que eu peço, sempre.",
    },
    {
      name: "Helena Dias",
      text: "Meu filho de 7 anos não queria sentar. O Caio teve paciência e o corte ficou alinhado.",
    },
    {
      name: "Bruno Paixão",
      text: "Pontual, conversa na medida e um acabamento que não abre em dois dias. Virou a minha cadeira fixa.",
    },
  ],
  gallery: [
    { src: img("photo-1585747860715-2ba37e788b70"), alt: "Interior da barbearia, com cadeiras e espelho" },
    { src: img("photo-1621605815971-fbc98d665033"), alt: "Barbeiro trabalhando em um degradê" },
    { src: img("photo-1599351431202-1e0f0137899a"), alt: "Cliente com corte baixo e barba alinhada" },
    { src: img("photo-1622286342621-4bd786c2447c"), alt: "Aparar a barba com navalha" },
    { src: img("photo-1605497788044-5a32c7078486"), alt: "Máquinas e tesouras na bancada" },
    { src: img("photo-1521590832167-7bcbfaa6381f"), alt: "Cadeiras da barbearia vistas de frente" },
  ],
};

export const ANY_BARBER = "any";
