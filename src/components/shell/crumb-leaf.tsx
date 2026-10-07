"use client";

import { usePathname } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

type Leaf = { path: string; name: string } | null;
const Ctx = createContext<{ leaf: Leaf; set: (l: Leaf) => void } | null>(null);

export function CrumbLeafProvider({ children }: { children: ReactNode }) {
  const [leaf, set] = useState<Leaf>(null);
  return <Ctx.Provider value={{ leaf, set }}>{children}</Ctx.Provider>;
}

// The header reads the name only while it belongs to the current URL.
export function useCrumbLeaf(): string | undefined {
  const pathname = usePathname();
  const leaf = useContext(Ctx)?.leaf;
  return leaf && leaf.path === pathname ? leaf.name : undefined;
}

// A page names its entity for the header's last crumb.
export function useSetCrumbLeaf(name: string | undefined): void {
  const pathname = usePathname();
  const set = useContext(Ctx)?.set;
  useEffect(() => {
    if (!set || !name) return;
    set({ path: pathname, name });
    return () => set(null);
  }, [set, pathname, name]);
}
