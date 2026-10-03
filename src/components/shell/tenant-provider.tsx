"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { SessionContext } from "@/lib/auth/session";
import type { LabelKey, LabelPack } from "@/lib/tenant/labels";
import type { AcademyChoice } from "./academy-menu";

export type BranchOption = { id: string; name: string };

export type TenantState = {
  session: SessionContext;
  tenantName: string;
  labels: LabelPack;
  branches: BranchOption[]; // the ones this staff member may pick
  currentBranchId: string | "all";
  academies: AcademyChoice[]; // linked academies to switch to
};

const Ctx = createContext<TenantState | undefined>(undefined);

export function TenantProvider({ value, children }: { value: TenantState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useTenantState(): TenantState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTenantState outside TenantProvider");
  return v;
}

export function useSession(): SessionContext {
  return useTenantState().session;
}

export function useTenantName(): string {
  return useTenantState().tenantName;
}

export function useAcademies(): AcademyChoice[] {
  return useTenantState().academies;
}

// docs/07: the screen says "Coach" or "Teacher"; the code always says staff.
export function useLabels(): LabelPack {
  return useTenantState().labels;
}

export function useLabel(key: LabelKey, form: "one" | "many" = "one"): string {
  return useLabels()[key][form];
}

export function useBranch(): { branches: BranchOption[]; currentBranchId: string | "all"; current: BranchOption | undefined } {
  const { branches, currentBranchId } = useTenantState();
  return { branches, currentBranchId, current: branches.find((b) => b.id === currentBranchId) };
}
