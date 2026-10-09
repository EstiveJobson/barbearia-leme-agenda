/** Brazilian area codes that are actually assigned. */
const DDDS = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "21", "22", "24", "27", "28",
  "31", "32", "33", "34", "35", "37", "38",
  "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "51", "53", "54", "55",
  "61", "62", "63", "64", "65", "66", "67", "68", "69",
  "71", "73", "74", "75", "77", "79",
  "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98", "99",
]);

/** Digits only. A leading 55 country code is removed when the rest is a local number. */
export function phoneDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  return digits;
}

/** Mask while typing. Mobile (starts with 9) uses (71) 99999-9999. */
export function maskBrazilianPhone(raw: string): string {
  const digits = phoneDigits(raw).slice(0, 11);
  if (!digits) return "";
  if (digits.length < 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (!rest) return `(${ddd}) `;
  const mobile = rest.startsWith("9");
  const headLen = mobile ? 5 : 4;
  const head = rest.slice(0, headLen);
  const tail = rest.slice(headLen, headLen + 4);
  return tail ? `(${ddd}) ${head}-${tail}` : `(${ddd}) ${head}`;
}

export type PhoneResult =
  | { ok: true; digits: string }
  | { ok: false; message: string };

/**
 * Local Brazilian number: valid DDD plus 10 digits (landline) or 11 (mobile).
 * An 11-digit number must start with 9. Stored value is digits only.
 */
export function parseBrazilianPhone(raw: string): PhoneResult {
  const digits = phoneDigits(raw);
  if (digits.length !== 10 && digits.length !== 11) {
    return { ok: false, message: "Use um telefone com DDD: 10 ou 11 dígitos." };
  }
  const ddd = digits.slice(0, 2);
  const number = digits.slice(2);
  if (!DDDS.has(ddd)) {
    return { ok: false, message: "Esse DDD não é válido." };
  }
  if (number.startsWith("9")) {
    if (digits.length !== 11) {
      return { ok: false, message: "Celular começa com 9 e tem 11 dígitos, com o DDD." };
    }
  } else if (digits.length === 11) {
    return { ok: false, message: "Celular precisa começar com 9." };
  }
  return { ok: true, digits };
}

/**
 * Opens a chat with the customer. Not the shop's WhatsApp.
 * Stored phones are digits with DDD. Returns null when the number is missing.
 */
export function customerWhatsAppLink(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone ?? "");
  if (digits.length !== 10 && digits.length !== 11) return null;
  return `https://wa.me/55${digits}`;
}
