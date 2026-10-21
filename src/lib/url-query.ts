import { isIsoDate } from "@/lib/dates";

// Same shape zod's uuid() takes, so this module stays out of the client bundle with the filter bar.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      return v && UUID.test(v) ? v : undefined;
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
