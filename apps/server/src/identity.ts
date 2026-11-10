import type { FastifyRequest } from "fastify";

export type IdentityMode = "local" | "test-hosted" | "hosted";
export type Principal = { subject: string; serviceId: "overposter" };
export interface IdentityProvider {
  readonly mode: IdentityMode;
  authenticate(request: FastifyRequest): Principal | Promise<Principal>;
}

const mode = process.env.OVERPOSTER_MODE || "local";
if (mode !== "local" && mode !== "test-hosted" && mode !== "hosted")
  throw new Error(`Unknown Overposter identity mode: ${mode}`);
export const testHosted = mode === "test-hosted";
const validSubject = (value: string) => /^[a-z][a-z0-9_.-]{0,63}$/i.test(value) && !["__proto__", "constructor", "prototype"].includes(value.toLowerCase());
export function validTestSubject(value: string): boolean { return validSubject(value); }

const localProvider: IdentityProvider = {
  mode: "local",
  authenticate: () => ({ subject: "local", serviceId: "overposter" }),
};
const testProvider: IdentityProvider = {
  mode: "test-hosted",
  authenticate(request) {
    const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("overposter_test_subject="));
    const value = request.headers["x-overposter-test-subject"] ?? (cookie ? decodeURIComponent(cookie.slice("overposter_test_subject=".length)) : undefined);
    if (typeof value !== "string" || !validSubject(value))
      throw Object.assign(new Error("A test identity is required"), { statusCode: 401 });
    return { subject: value, serviceId: "overposter" };
  },
};
const unavailableHostedProvider: IdentityProvider = {
  mode: "hosted",
  authenticate: () => { throw new Error("Site account integration is not configured"); },
};
export const identityProvider: IdentityProvider = mode === "test-hosted" ? testProvider : mode === "hosted" ? unavailableHostedProvider : localProvider;
export async function subjectForRequest(request: FastifyRequest): Promise<string> {
  return (await identityProvider.authenticate(request)).subject;
}
