import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { ThemeProvider, themeScript } from "@/components/theme-provider";
import styles from "@/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sentinel · System overview" },
      {
        name: "description",
        content:
          "A simple view of your machine. Live system metrics with local history.",
      },
    ],
    links: [
      { rel: "stylesheet", href: styles },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <Outlet />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl p-12">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <a href="/" className="mt-4 inline-block text-primary underline">
        Back to overview
      </a>
    </main>
  ),
});
