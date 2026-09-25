import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PrintReceipt } from "@/components/payments/payment-actions";
import { ReceiptCard } from "@/components/payments/receipt-card";
import { slugFromHost } from "@/modules/auth/routes";
import { sharedReceipt } from "@/modules/messaging/public";

// Private: never indexed, and the token isn't passed on to other sites.
export const metadata: Metadata = { title: "Receipt", robots: { index: false, follow: false }, referrer: "no-referrer" };

// A family's private receipt link (docs/03 §10): no sign-in, this receipt only.
export default async function SharedReceiptPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  const r = await sharedReceipt(token, slugFromHost((await headers()).get("host")));
  if (!r) notFound();
  return (
    <main className="mx-auto w-full max-w-xl p-4 print:p-0">
      <ReceiptCard r={r} />
      <div className="mt-4 flex justify-center print:hidden">
        <PrintReceipt />
      </div>
    </main>
  );
}
