import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Activity, ArrowRight, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ThemeSwitcher } from "@/components/theme-switcher";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in · Sentinel" }] }),
  component: Login,
});
function Login() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          password: form.get("password"),
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Could not sign in.");
      }
      window.location.replace("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect. Try again.",
      );
      setBusy(false);
    }
  }
  const inputStyle =
    "mt-2 h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
  return (
    <main className="flex min-h-screen flex-col px-5 py-6 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
            <Activity className="size-4" />
          </span>
          sentinel<span className="-ml-2 text-primary">.</span>
        </span>
        <ThemeSwitcher />
      </header>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
        <Card className="shadow-none">
          <CardContent className="px-6 sm:px-7">
            <span className="mb-6 flex size-10 items-center justify-center rounded-xl border bg-muted">
              <LockKeyhole className="size-4 text-primary" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome back
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to your system dashboard.
            </p>
            <form
              className="mt-7 space-y-5"
              onSubmit={(event) => void submit(event)}
            >
              <label className="block text-xs font-medium">
                Username
                <input
                  className={inputStyle}
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={256}
                  required
                  autoFocus
                  disabled={busy}
                />
              </label>
              <label className="block text-xs font-medium">
                Password
                <input
                  className={inputStyle}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  maxLength={1024}
                  required
                  disabled={busy}
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="h-11 w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
                <ArrowRight className="size-4" />
              </Button>
            </form>
            <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
              You’ll stay signed in on this browser until you sign out.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
