import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AuthService,
  readAuthConfig,
  sessionCookie,
} from "../src/server/auth.server";

const services: AuthService[] = [];
const directories: string[] = [];
const credentials = {
  username: "test-user",
  password: "disposable-test-password",
  publicOrigin: null,
};
const request = (token: string) =>
  new Request("http://127.0.0.1/", {
    headers: { Cookie: `${sessionCookie}=${token}` },
  });
afterEach(async () => {
  for (const auth of services.splice(0)) await auth.close();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
function memory(config = credentials) {
  const auth = new AuthService(":memory:", config);
  services.push(auth);
  return auth;
}

test("authentication fails closed without complete environment credentials", () => {
  for (const env of [
    {},
    { SENTINEL_USERNAME: "user" },
    { SENTINEL_PASSWORD: "password" },
    { SENTINEL_USERNAME: " ", SENTINEL_PASSWORD: "password" },
  ])
    expect(() => readAuthConfig(env)).toThrow("SENTINEL_USERNAME");
  expect(
    readAuthConfig({ SENTINEL_USERNAME: "user", SENTINEL_PASSWORD: "password" })
      .publicOrigin,
  ).toBeNull();
  for (const url of [
    "not a url",
    "https://user:secret@example.com",
    "https://example.com/path",
  ])
    expect(() =>
      readAuthConfig({
        SENTINEL_USERNAME: "user",
        SENTINEL_PASSWORD: "password",
        SENTINEL_PUBLIC_URL: url,
      }),
    ).toThrow("SENTINEL_PUBLIC_URL");
});

test("sessions are opaque, persist across restarts, and are revoked on credential changes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sentinel-auth-"));
  directories.push(directory);
  const path = join(directory, "auth.sqlite");
  const auth = new AuthService(path, credentials);
  const result = await auth.signIn(credentials.username, credentials.password);
  expect("token" in result).toBe(true);
  if (!("token" in result)) return;
  expect(result.token).not.toContain(credentials.username);
  expect(await auth.authenticated(request(result.token))).toBe(true);
  await auth.close();
  const db = new Database(path);
  const row = db
    .query<{ token_hash: string }, []>("SELECT token_hash FROM auth_sessions")
    .get()!;
  expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(row.token_hash).not.toBe(result.token);
  expect(
    db
      .query<{ password_hash: string }, []>(
        "SELECT password_hash FROM auth_identity",
      )
      .get()!.password_hash,
  ).toStartWith("$argon2id$");
  db.close();
  const restarted = new AuthService(path, credentials);
  expect(await restarted.authenticated(request(result.token))).toBe(true);
  await restarted.close();
  const changed = new AuthService(path, {
    ...credentials,
    password: "new-disposable-password",
  });
  services.push(changed);
  expect(await changed.authenticated(request(result.token))).toBe(false);
  expect(
    await changed.signIn(credentials.username, credentials.password),
  ).toEqual({ status: 401 });
});

test("rejects forged tokens, revokes logout sessions, and limits guessing", async () => {
  const auth = memory();
  expect(await auth.authenticated(request("not-a-session"))).toBe(false);
  expect(await auth.authenticated(request("x".repeat(43)))).toBe(false);
  const result = await auth.signIn(credentials.username, credentials.password);
  if (!("token" in result)) throw new Error("Login failed");
  auth.revoke(request(result.token));
  expect(await auth.authenticated(request(result.token))).toBe(false);
  for (let i = 0; i < 10; i++)
    expect(await auth.signIn("unknown", "wrong")).toEqual({ status: 401 });
  expect(await auth.signIn(credentials.username, credentials.password)).toEqual(
    { status: 429 },
  );
});

test("sets HttpOnly rolling cookies and validates the configured HTTPS origin behind a proxy", async () => {
  const auth = new AuthService(":memory:", {
    ...credentials,
    publicOrigin: "https://status.example.com",
  });
  services.push(auth);
  const proxied = new Request("http://127.0.0.1:3000/api/auth/login", {
    headers: { Origin: "https://status.example.com" },
  });
  expect(auth.sameOrigin(proxied)).toBe(true);
  expect(
    auth.sameOrigin(
      new Request(proxied.url, {
        headers: { Origin: "https://attacker.example" },
      }),
    ),
  ).toBe(false);
  expect(auth.sameOrigin(new Request(proxied.url))).toBe(false);
  const cookie = auth.cookie(proxied, "opaque-token");
  for (const flag of [
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=34560000",
    "Secure",
  ])
    expect(cookie).toContain(flag);
  expect(auth.cookie(proxied, null)).toContain("Max-Age=0");
  const local = memory();
  expect(
    local.cookie(new Request("http://127.0.0.1/"), "opaque-token"),
  ).not.toContain("Secure");
});
