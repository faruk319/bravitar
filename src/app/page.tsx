import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-display">Bravitar</h1>
      <p className="text-caption text-muted-foreground">Slice 0 — repo skeleton</p>
      <Button>Primary action</Button>
    </main>
  );
}
