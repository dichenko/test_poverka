import { AppError } from "../../common/app-error";

export function rublesToYookassaAmount(rubles: bigint): string {
  if (rubles < 0n) {
    throw new AppError("Negative amount is not allowed.", 500, "PAYMENT_AMOUNT_NEGATIVE");
  }
  return `${rubles.toString()}.00`;
}

export function parseYookassaAmountToRubles(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new AppError("Unsupported YooKassa amount format.", 500, "PAYMENT_AMOUNT_INVALID", { value });
  }

  const [rublesRaw, centsRaw = ""] = normalized.split(".");
  const rubles = BigInt(rublesRaw);
  const cents = centsRaw.padEnd(2, "0");

  if (cents !== "00") {
    throw new AppError("Amount with fractional rubles is not supported.", 500, "PAYMENT_AMOUNT_WITH_KOPECKS", {
      value
    });
  }

  return rubles;
}

export function formatRubles(rubles: bigint): string {
  return rubles.toString();
}
