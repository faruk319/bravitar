import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";

// App-runtime connection. Production goes through Supabase's transaction-mode
// pooler, where prepared statements do not survive; hence prepare: false.
export const sql = postgres(getEnv().DATABASE_URL, { prepare: false });

export const db = drizzle(sql);

export type Db = typeof db;
