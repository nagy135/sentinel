import { Database } from "bun:sqlite";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { readConfig } from "./config.server";

export const sessionCookie = "sentinel_session";
const cookieLifetime = 400 * 24 * 60 * 60;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function readAuthConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const username = env.SENTINEL_USERNAME;
  const password = env.SENTINEL_PASSWORD;
  if (
    !username?.trim() ||
    username.length > 256 ||
    !password ||
    password.length > 1024
  )
    throw new Error(
      "Set SENTINEL_USERNAME and SENTINEL_PASSWORD before starting Sentinel (username ≤256 characters, password ≤1024).",
    );
  let publicOrigin: string | null = null;
  if (env.SENTINEL_PUBLIC_URL) {
    try {
      const url = new URL(env.SENTINEL_PUBLIC_URL);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error();
      publicOrigin = url.origin;
    } catch {
      throw new Error(
        "SENTINEL_PUBLIC_URL must be an HTTP(S) origin without a path or credentials.",
      );
    }
  }
  return { username, password, publicOrigin };
}
type AuthConfig = ReturnType<typeof readAuthConfig>;

export class AuthService {
  private db: Database;
  private passwordHash = "";
  private failures: number[] = [];
  private inFlight = 0;
  readonly ready: Promise<void>;
  constructor(
    path: string,
    private config: AuthConfig,
  ) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
      closeSync(openSync(path, "a", 0o600));
    }
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS auth_identity (id INTEGER PRIMARY KEY CHECK (id=1), username_hash TEXT NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL);`);
    this.ready = this.initialize();
  }
  private async initialize() {
    const saved = this.db
      .query<{ username_hash: string; password_hash: string }, []>(
        "SELECT username_hash, password_hash FROM auth_identity WHERE id=1",
      )
      .get();
    if (
      saved &&
      saved.username_hash === digest(this.config.username) &&
      (await Bun.password.verify(this.config.password, saved.password_hash))
    ) {
      this.passwordHash = saved.password_hash;
      return;
    }
    this.passwordHash = await Bun.password.hash(this.config.password, {
      algorithm: "argon2id",
    });
    this.db.transaction(() => {
      this.db.exec("DELETE FROM auth_sessions");
      this.db
        .query(
          "INSERT OR REPLACE INTO auth_identity (id, username_hash, password_hash) VALUES (1, ?, ?)",
        )
        .run(digest(this.config.username), this.passwordHash);
    })();
  }
  token(request: Request) {
    const value = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${sessionCookie}=`))
      ?.slice(sessionCookie.length + 1);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  async authenticated(request: Request) {
    await this.ready;
    const token = this.token(request);
    return (
      !!token &&
      !!this.db
        .query("SELECT 1 FROM auth_sessions WHERE token_hash=?")
        .get(digest(token))
    );
  }
  async signIn(
    username: string,
    password: string,
  ): Promise<{ token: string } | { status: 401 | 429 }> {
    await this.ready;
    const now = Date.now();
    this.failures = this.failures.filter((time) => time > now - 60000);
    if (this.failures.length >= 10 || this.inFlight >= 2)
      return { status: 429 };
    this.inFlight++;
    try {
      // Verify the password even for an unknown username; avoid exposing which field failed.
      const passwordMatches = await Bun.password.verify(
        password,
        this.passwordHash,
      );
      const usernameMatches = timingSafeEqual(
        Buffer.from(digest(username)),
        Buffer.from(digest(this.config.username)),
      );
      if (!passwordMatches || !usernameMatches) {
        this.failures.push(Date.now());
        return { status: 401 };
      }
      this.failures = [];
      const token = randomBytes(32).toString("base64url");
      this.db
        .query(
          "INSERT INTO auth_sessions (token_hash, created_at) VALUES (?, ?)",
        )
        .run(digest(token), now);
      return { token };
    } finally {
      this.inFlight--;
    }
  }
  revoke(request: Request) {
    const token = this.token(request);
    if (token)
      this.db
        .query("DELETE FROM auth_sessions WHERE token_hash=?")
        .run(digest(token));
  }
  origin(request: Request) {
    return this.config.publicOrigin ?? new URL(request.url).origin;
  }
  sameOrigin(request: Request) {
    return (
      request.headers.get("sec-fetch-site") !== "cross-site" &&
      request.headers.get("origin") === this.origin(request)
    );
  }
  cookie(request: Request, token: string | null) {
    const secure = new URL(this.origin(request)).protocol === "https:";
    return `${sessionCookie}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? cookieLifetime : 0}${secure ? "; Secure" : ""}`;
  }
  async close() {
    await this.ready.catch(() => {});
    this.db.close();
  }
}

const state = globalThis as typeof globalThis & {
  __sentinelAuth?: AuthService;
};
export function getAuth() {
  return (state.__sentinelAuth ??= new AuthService(
    `${readConfig().dbPath}.auth.sqlite`,
    readAuthConfig(),
  ));
}
export async function closeAuth() {
  await state.__sentinelAuth?.close();
}
