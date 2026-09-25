import { getEnv } from "@/lib/env";

// The academy's own address, e.g. http://shivaji-karate.localhost:3000. Links in
// messages and webhook URLs point here.
export function tenantOrigin(slug: string): string {
  const env = getEnv();
  return `${env.NODE_ENV === "production" ? "https" : "http"}://${slug}.${env.APP_DOMAIN}`;
}
