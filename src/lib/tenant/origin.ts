import { getEnv } from "@/lib/env";

const scheme = () => (getEnv().NODE_ENV === "production" ? "https" : "http");

// The academy's own address, e.g. http://shivaji-karate.localhost:3000. Links in
// messages and webhook URLs point here.
export function tenantOrigin(slug: string): string {
  return `${scheme()}://${slug}.${getEnv().APP_DOMAIN}`;
}

// The main site: sign-in and /platform.
export function mainOrigin(): string {
  return `${scheme()}://${getEnv().APP_DOMAIN}`;
}
