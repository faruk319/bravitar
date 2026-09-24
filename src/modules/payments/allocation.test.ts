import { describe, expect, it } from "vitest";
import { oldestFirst, picked, refundFrom } from "./allocation";

const open = [
  { invoiceId: "sep", balance: 150_000n },
  { invoiceId: "oct", balance: 150_000n },
];

describe("oldestFirst", () => {
  it("fills the oldest invoice first and keeps the rest as advance", () => {
    expect(oldestFirst(80_000n, open)).toEqual({ shares: [{ invoiceId: "sep", amountPaise: 80_000n }], advance: 0n });
    expect(oldestFirst(300_000n, open)).toEqual({
      shares: [
        { invoiceId: "sep", amountPaise: 150_000n },
        { invoiceId: "oct", amountPaise: 150_000n },
      ],
      advance: 0n,
    });
    expect(oldestFirst(500_000n, open).advance).toBe(200_000n);
  });

  it("with nothing open, all of it is advance", () => {
    expect(oldestFirst(50_000n, [])).toEqual({ shares: [], advance: 50_000n });
  });

  it("skips an invoice with nothing left to pay", () => {
    expect(oldestFirst(1_000n, [{ invoiceId: "zero", balance: 0n }, ...open]).shares).toEqual([{ invoiceId: "sep", amountPaise: 1_000n }]);
  });
});

describe("picked", () => {
  it("pays only the chosen invoices, in oldest-first order, and keeps the rest as advance", () => {
    expect(picked(200_000n, open, [{ invoiceId: "oct", amountPaise: 150_000n }])).toEqual({ shares: [{ invoiceId: "oct", amountPaise: 150_000n }], advance: 50_000n });
    expect(
      picked(200_000n, open, [
        { invoiceId: "oct", amountPaise: 100_000n },
        { invoiceId: "sep", amountPaise: 100_000n },
      ]).shares.map((s) => s.invoiceId),
    ).toEqual(["sep", "oct"]);
  });

  it("refuses an invoice that isn't open, a repeat, a zero, more than a balance, or more than the payment", () => {
    expect(() => picked(100n, open, [{ invoiceId: "other", amountPaise: 100n }])).toThrow("isn't open for this family");
    expect(() =>
      picked(300n, open, [
        { invoiceId: "sep", amountPaise: 100n },
        { invoiceId: "sep", amountPaise: 100n },
      ]),
    ).toThrow("listed twice");
    expect(() => picked(100n, open, [{ invoiceId: "sep", amountPaise: 0n }])).toThrow("more than zero");
    expect(() => picked(200_000n, open, [{ invoiceId: "sep", amountPaise: 150_001n }])).toThrow("more than the invoice's balance");
    expect(() =>
      picked(200_000n, open, [
        { invoiceId: "sep", amountPaise: 150_000n },
        { invoiceId: "oct", amountPaise: 60_000n },
      ]),
    ).toThrow("add up to more than the payment");
  });
});

describe("refundFrom", () => {
  const paid = [
    { invoiceId: "oct", net: 150_000n },
    { invoiceId: "sep", net: 150_000n },
  ];

  it("takes the unused advance first", () => {
    expect(refundFrom(50_000n, 50_000n, paid)).toEqual({ fromAdvance: 50_000n, fromInvoices: [] });
    expect(refundFrom(70_000n, 50_000n, paid)).toEqual({ fromAdvance: 50_000n, fromInvoices: [{ invoiceId: "oct", amountPaise: 20_000n }] });
  });

  it("then the picked invoice, then the latest due", () => {
    expect(refundFrom(200_000n, 0n, paid, "sep").fromInvoices).toEqual([
      { invoiceId: "sep", amountPaise: 150_000n },
      { invoiceId: "oct", amountPaise: 50_000n },
    ]);
  });

  it("never more than is left on the payment", () => {
    expect(() => refundFrom(350_001n, 50_000n, paid)).toThrow("Only ₹3,500 is left on this payment");
  });
});
