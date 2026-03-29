import { AppError } from "../../common/app-error";

export function kopecksToYookassaAmount(kopecks: bigint): string {
  if (kopecks < 0n) {
    throw new AppError("Negative amount is not allowed.", 500, "PAYMENT_AMOUNT_NEGATIVE");
  }

  const rubles = kopecks / 100n;
  const cents = kopecks % 100n;
  return `${rubles.toString()}.${cents.toString().padStart(2, "0")}`;
}

export function parseYookassaAmountToKopecks(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new AppError("Unsupported YooKassa amount format.", 500, "PAYMENT_AMOUNT_INVALID", { value });
  }

  const [rublesRaw, centsRaw = ""] = normalized.split(".");
  const rubles = BigInt(rublesRaw);
  const cents = BigInt(centsRaw.padEnd(2, "0"));
  return rubles * 100n + cents;
}

export function formatKopecksAsRubles(kopecks: bigint): string {
  const sign = kopecks < 0n ? "-" : "";
  const absolute = kopecks < 0n ? kopecks * -1n : kopecks;
  const rubles = absolute / 100n;
  const cents = absolute % 100n;
  return `${sign}${rubles.toString()}.${cents.toString().padStart(2, "0")}`;
}

export function legacyRublesToKopecks(value: number | null | undefined): bigint {
  if (value == null || !Number.isFinite(value)) {
    return 0n;
  }
  return BigInt(Math.max(0, Math.round(value * 100)));
}
