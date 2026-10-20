import { z } from "zod";
import { isIsoDate } from "@/lib/dates";

export type SearchParams = Record<string, string | string[] | undefined>;

// A list's address read one value at a time; a value that is not valid is dropped, so a stale link still loads.
export function queryReader(sp: SearchParams) {
  const one = (k: string): string | undefined => {
    const v = sp[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  return {
    one,
    id: (k: string) => {
      const v = one(k);
      return v && z.uuid().safeParse(v).success ? v : undefined;
    },
    day: (k: string) => {
      const v = one(k);
      return v && isIsoDate(v) ? v : undefined;
    },
    oneOf: <T extends string>(k: string, allowed: readonly T[]): T | undefined => allowed.find((a) => a === one(k)),
    page: () => Math.max(1, Math.floor(Number(one("page"))) || 1),
  };
}

// The path and its query; the bare path when there is none.
export const withQuery = (path: string, params: URLSearchParams): string => (params.toString() ? `${path}?${params.toString()}` : path);
