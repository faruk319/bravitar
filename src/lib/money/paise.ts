// Money is bigint paise, always (CLAUDE.md rule 3). No floats anywhere in here.
export type Paise = bigint;

// num / den rounded half away from zero, e.g. 1,499,994 / 100 → 15,000.
export function roundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new Error("roundHalfUp: denominator must be positive");
  const sign = num < 0n ? -1n : 1n;
  const abs = num < 0n ? -num : num;
  return sign * ((abs * 2n + den) / (2n * den));
}

export function sum(xs: Paise[]): Paise {
  return xs.reduce((a, b) => a + b, 0n);
}

export const add = (...xs: Paise[]): Paise => sum(xs);

export const subtract = (a: Paise, b: Paise): Paise => a - b;

// Basis points: 18% = 1800 (docs/04 tax_rate_bp). Per line, then summed.
export function percent(amount: Paise, bp: number): Paise {
  if (!Number.isInteger(bp) || bp < 0) throw new Error("percent: basis points must be a non-negative integer");
  return roundHalfUp(amount * BigInt(bp), 10000n);
}

// Shares that always add back to the total (largest remainder; ties to the
// earlier part): ₹1,000 / 3 = 333.34 + 333.33 + 333.33.
export function split(total: Paise, parts: number | number[]): Paise[] {
  const weights = typeof parts === "number" ? Array.from({ length: parts }, () => 1) : parts;
  if (total < 0n) throw new Error("split: total must not be negative");
  if (!weights.length || weights.some((w) => !Number.isInteger(w) || w < 0)) throw new Error("split: weights must be non-negative integers");
  const whole = BigInt(weights.reduce((a, b) => a + b, 0));
  if (whole === 0n) throw new Error("split: weights must not all be zero");
  const shares = weights.map((w) => (total * BigInt(w)) / whole);
  const rest = weights.map((w, i) => ({ i, r: (total * BigInt(w)) % whole }));
  let left = total - sum(shares);
  for (const { i } of rest.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1))) {
    if (left === 0n) break;
    shares[i] = (shares[i] ?? 0n) + 1n;
    left--;
  }
  return shares;
}

// What people type in a form ("₹ 1,500.50") → paise; undefined if it isn't money.
export function parseRupees(input: string): Paise | undefined {
  const s = input.replace(/₹|\s/g, "");
  if (!/^\d{1,3}(,\d{2,3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const [rupees = "0", fraction = ""] = s.replace(/,/g, "").split(".");
  return BigInt(rupees) * 100n + BigInt(fraction.padEnd(2, "0"));
}
