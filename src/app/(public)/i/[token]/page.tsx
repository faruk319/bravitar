import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { InvoiceStatus } from "@/components/fees/invoice-status";
import { InvoiceFacts, InvoiceLines } from "@/components/fees/invoice-view";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { slugFromHost } from "@/modules/auth/routes";
import { sharedInvoice } from "@/modules/messaging/public";

// Private: never indexed, and the token isn't passed on to other sites.
export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false }, referrer: "no-referrer" };

// A family's private invoice link (docs/03 §10). "Pay online" appears when the
// academy has connected Razorpay and money is still due.
export default async function SharedInvoicePage({ params, searchParams }: PageProps<"/i/[token]">) {
  const { token } = await params;
  const failed = (await searchParams).error === "1";
  const d = await sharedInvoice(token, slugFromHost((await headers()).get("host")));
  if (!d) notFound();
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-caption text-muted-foreground">{d.academy.name}</p>
          <h1 className="text-display tabular-nums">{d.invoice.number}</h1>
        </div>
        <InvoiceStatus status={d.invoice.status} overdue={d.overdue} />
      </div>
      {d.payOnline ? (
        <Button size="lg" nativeButton={false} render={<a href={`/i/${token}/pay`} />}>
          Pay online
        </Button>
      ) : null}
      {failed ? (
        <p role="alert" className="text-label text-danger-600">
          Online payment isn&apos;t available right now. Please pay at the academy.
        </p>
      ) : null}
      <Card>
        <InvoiceLines d={d} />
      </Card>
      <Card>
        <InvoiceFacts d={d} />
      </Card>
    </main>
  );
}
