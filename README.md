# Sentinel

A small, self-hosted system dashboard built with TanStack Start, React, TypeScript, and Bun. It detects its Linux or macOS host automatically and collects metrics with `systeminformation`.

## Run

Install [Bun](https://bun.sh) (developed with Bun 1.4.2), then:

```sh
bun install
bun run dev
```

Open **http://127.0.0.1:3000**. This one command starts both the dashboard and the background collector. The server binds to localhost; no login or external metrics service is required. Collection continues when the browser is closed and stops when the dev process stops.

For production, build once and start the Bun server:

```sh
bun install --frozen-lockfile
bun run build
bun start
```

The production runner serves the built dashboard and starts the collector without Vite or source watching. It also binds to localhost, ready for an HTTPS reverse proxy. Set `SENTINEL_DB_PATH` to persistent storage outside the checkout. Authentication is not included yet.

## Configuration

Copy `.env.example` to `.env` to change settings, or pass environment variables directly:

```sh
SENTINEL_INTERVAL_MS=10000 bun run dev
```

| Variable               | Default                  | Meaning                                                              |
| ---------------------- | ------------------------ | -------------------------------------------------------------------- |
| `SENTINEL_INTERVAL_MS` | `5000`                   | Collection interval in milliseconds; integer, minimum 1000.          |
| `SENTINEL_DB_PATH`     | `./data/sentinel.sqlite` | SQLite database path, relative to the project directory or absolute. |
| `PORT`                 | `3000`                   | Local dashboard port.                                                |

Restart the dev command after changing environment settings. Source edits to the collector restart the Bun process; Vite handles UI hot reloads.

## Dashboard

- Automatic hostname, OS/release, kernel, architecture, hardware, and CPU detection.
- Total and per-core CPU activity; active RAM, total RAM, and swap use.
- Mounted filesystem usage, with the primary volume shown in the overview.
- Receive/send throughput and individual active non-loopback network interfaces.
- System uptime and collector status.
- Interactive CPU, memory, storage, and network history charts, from 15 minutes to all history.
- Custom start/end dates and drag-to-zoom on every graph, synchronized across all graphs. Fixed ranges keep their exact bounds while collection continues.
- System, Light, and Dark appearance options; defaults to System. The preference is saved in the browser, and System follows OS appearance changes.

The first network rate is unavailable until two counter samples exist. Counters that reset also wait for a fresh interval. Missing readings are shown as unavailable rather than zero. Network totals include virtual interfaces and bridges, so forwarded traffic can appear on more than one interface.

Memory usage is active memory as reported by `systeminformation`, excluding reclaimable buffers/cache. Filesystem percentages use the OS-reported usage percentage (which can account for reserved space). Used and available bytes are shown separately. APFS volumes can share free space; their capacities are never added together. On macOS, the Data volume is used for the storage overview when available.

## History

Every sample is retained in local SQLite, including detailed per-core, disk, and interface snapshots. Nothing is automatically expired or deleted. The database and its WAL files live in the ignored `data/` directory by default.

Charts query approximately 360 averaged time buckets per selected range. This bounds response size while leaving all raw samples intact. `All history` includes samples from previous runs using the same database. Long all-history queries will require more work as the database grows; persistent rollups can be added later.

Drag horizontally across the plotted area of any graph to inspect that time span. Dragging in either direction works, including across filled areas. A further drag zooms in again. Use **Undo zoom** to return one step, or **Reset to live** to return to the preset you started with. Press Escape to cancel an in-progress selection. Touch gestures allow horizontal selection while preserving vertical page scrolling.

Select **Custom range** in the time menu to enter a start and end date/time in your browser's local timezone. **Edit range** changes a fixed range. Empty windows are shown explicitly; changing the history range never stops live collection or changes stored data. Zoom queries SQLite again, so narrower windows recover detail from the original samples.

The dashboard reads `GET /api/metrics?range=1h`. Supported presets: `15m`, `1h`, `6h`, `24h`, `7d`, and `all`. Fixed ranges use `?range=custom&from=<epoch-ms>&to=<epoch-ms>` (inclusive bounds). The response includes the requested `range` and the resolved `window` shared by every graph. Invalid or reversed boundaries return HTTP 400. There are no write endpoints.

## Checks

```sh
bun run build
bun run typecheck
bun test
```

The first build or dev run generates TanStack Router's `src/routeTree.gen.ts`. The build emits client/server bundles used by `bun start`.

## Code

- `scripts/dev.ts` starts Vite and the collector together.
- `scripts/start.ts` serves the production build and starts the collector together.
- `src/server/` contains the platform adapter, configuration, and Bun SQLite store; these modules stay on the server.
- `src/routes/api.metrics.ts` exposes the read-only dashboard snapshot and history.
- `src/components/` contains the dashboard, Recharts graphs, and theme handling.
- `src/components/ui/` contains shadcn/ui components; `components.json` configures the CLI.

Platform support uses the operating system where Bun runs. Inside a Linux container, metrics describe the container's visible environment, not the macOS host. No root privileges or optional hardware tools are needed for the initial metric set; availability still depends on the host's permissions and utilities.

Implementation references: [TanStack Start setup](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch), [systeminformation](https://systeminformation.io), [Bun SQLite](https://bun.sh/docs/runtime/sqlite), and [shadcn/ui](https://ui.shadcn.com).
