// Rendered inside the client shell, so the year can differ from the server's
// only around New Year in another timezone; suppress that one-off mismatch.
export function Footer() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  return (
    <footer className="border-t border-neutral-100 px-4 py-3 text-label text-muted-foreground md:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <span suppressHydrationWarning>&copy; {new Date().getFullYear()} Bravitar</span>
        {version ? <span> · v{version}</span> : null}
      </div>
    </footer>
  );
}
