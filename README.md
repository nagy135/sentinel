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

## Docker Compose (Linux host monitoring)

The image is `viktornagy/sentinel`, published for Linux AMD64 and ARM64. On a Linux Docker Engine host, download the Compose file and start Sentinel:

```sh
mkdir sentinel && cd sentinel
curl -fsSLo compose.yml https://raw.githubusercontent.com/nagy135/sentinel/master/compose.yml
docker compose pull
docker compose up -d
```

Open **http://127.0.0.1:3000** on that host. From another machine, use an SSH tunnel, for example `ssh -L 3000:127.0.0.1:3000 user@your-host`, then open the same local URL.

The supplied [compose.yml](compose.yml) is:

```yaml
# Linux host monitoring. Use compose.container.yml for an ordinary container.
services:
  sentinel:
    image: ${SENTINEL_IMAGE:-viktornagy/sentinel:latest}
    restart: unless-stopped
    init: true
    network_mode: host
    pid: host
    uts: host
    environment:
      PORT: ${SENTINEL_PORT:-3000}
      SENTINEL_HOST: "127.0.0.1"
      SENTINEL_HOST_ROOT: /host
      SENTINEL_INTERVAL_MS: ${SENTINEL_INTERVAL_MS:-5000}
      SENTINEL_DB_PATH: /data/sentinel.sqlite
    volumes:
      - sentinel_data:/data
      - type: bind
        source: /
        target: /host
        read_only: true
        bind:
          propagation: rslave
      - type: bind
        source: /sys
        target: /sys
        read_only: true

volumes:
  sentinel_data:
```

Host mode shares the Linux host's network, PID, and hostname namespaces. The host root and `/sys` are mounted read-only; there is no Docker socket mount or privileged mode. The image runs as the non-root `bun` user. CPU, memory, load, uptime, and network readings come from the host; OS identity is read from `/host`, and volume paths are mapped back to host paths. The root filesystem is measured directly if `df` omits its duplicate bind mount. Sensors and other files must be readable by this user; unavailable readings stay unavailable.

The listener stays on **127.0.0.1**, including in host-network mode. There is no authentication. Use your existing HTTPS reverse proxy if you want remote access. Host mode uses no `ports` mapping; change `SENTINEL_PORT` to choose another host port.

SQLite history lives in the named `sentinel_data` volume at `/data/sentinel.sqlite` and survives container recreation and image upgrades. `docker compose down` keeps it; `docker compose down --volumes` deletes it.

To change settings, create a `.env` beside `compose.yml`:

```dotenv
SENTINEL_IMAGE=viktornagy/sentinel:v0.1.0
SENTINEL_PORT=3000
SENTINEL_INTERVAL_MS=5000
```

Use a versioned image to pin a deployment, or `latest` to follow releases. Update and inspect the service with:

```sh
docker compose pull
docker compose up -d
docker compose logs --tail=100 sentinel
docker compose ps
```

The Docker health check verifies that the API responds and the collector is saving fresh samples.

### Build the image locally

```sh
git clone https://github.com/nagy135/sentinel.git
cd sentinel
docker build -t sentinel:local .
SENTINEL_IMAGE=sentinel:local docker compose up -d --pull never
```

The Dockerfile installs locked dependencies, builds and typechecks the application, then copies the built dashboard, server adapter, and production dependencies into the runtime image. Bun is pinned to 1.4.2.

### Ordinary container / macOS Docker

Docker on macOS runs Linux in a VM and cannot collect native Mac host metrics. Run `bun run dev` or `bun start` directly on macOS to monitor the Mac. The Linux host-mode file is intended for a Linux Docker Engine host.

For an ordinary container without host mounts or shared namespaces, use [compose.container.yml](compose.container.yml):

```sh
curl -fsSLo compose.container.yml https://raw.githubusercontent.com/nagy135/sentinel/master/compose.container.yml
docker compose -f compose.container.yml pull
docker compose -f compose.container.yml up -d
```

This publishes the dashboard only on `127.0.0.1:3000`. Metrics describe the container's visible Linux environment, which can include VM-wide CPU, memory, and load readings; they are not per-container resource accounting. It uses the same named data volume, so run only one Compose variant in a project at a time. When switching variants, run `docker compose -f <old-file> down` first, without `--volumes`.

## Docker Hub releases

[Publish Docker image](.github/workflows/publish-docker.yml) follows the [mongo-backup release pattern](https://github.com/nagy135/mongo-backup): a version tag is published only if its commit is contained in `master`. Both the exact tag and `latest` are pushed to Docker Hub. Non-version tags and tags outside `master` are skipped.

Configure the GitHub repository secret **DOCKERHUB_TOKEN** with a Docker Hub personal access token that can write to **viktornagy/sentinel**. Then tag a commit from `master`:

```sh
git switch master
git pull --ff-only
git tag v0.1.0
git push origin v0.1.0
```

The workflow runs production tests and a Docker Compose smoke test before publishing multi-platform images:

```text
viktornagy/sentinel:v0.1.0
viktornagy/sentinel:latest
```

Version tags without the `v` prefix are also supported. Every eligible version updates `latest`, matching mongo-backup. The token stays in GitHub Actions secrets; it is never part of the image.

## Configuration

Copy `.env.example` to `.env` to change settings, or pass environment variables directly:

```sh
SENTINEL_INTERVAL_MS=10000 bun run dev
```

| Variable               | Default                  | Meaning                                                              |
| ---------------------- | ------------------------ | -------------------------------------------------------------------- |
| `SENTINEL_INTERVAL_MS` | `5000`                   | Collection interval in milliseconds; integer, minimum 1000.          |
| `SENTINEL_DB_PATH`     | `./data/sentinel.sqlite` | SQLite database path, relative to the project directory or absolute. |
| `PORT`                 | `3000`                   | Dashboard port.                                                      |
| `SENTINEL_HOST`        | `127.0.0.1`              | Bind address: `127.0.0.1` or `0.0.0.0`. The image defaults to `0.0.0.0`; host-mode Compose overrides it to localhost. |
| `SENTINEL_HOST_ROOT`   | Unset                    | Linux host root mounted read-only, set to `/host` by host-mode Compose. |

Restart the dev command after changing environment settings. Source edits to the collector restart the Bun process; Vite handles UI hot reloads.

## Dashboard

- Automatic hostname, OS/release, kernel, architecture, hardware, and CPU detection.
- Total and per-core CPU activity; active RAM, total RAM, and swap use.
- System load averages over 1, 5, and 15 minutes, plus CPU temperature when a readable sensor is available.
- Mounted filesystem usage, with the primary volume shown in the overview.
- Receive/send throughput and individual active non-loopback network interfaces.
- System uptime and collector status.
- Interactive CPU, memory, load, temperature, storage, and network history charts, from 15 minutes to all history.
- Custom start/end dates and drag-to-zoom on every graph, synchronized across all graphs. Fixed ranges keep their exact bounds while collection continues.
- System, Light, and Dark appearance options; defaults to System. The preference is saved in the browser, and System follows OS appearance changes.
- **Edit dashboard** reveals a remove button and drag handle for every block. **Add blocks** opens a sidebar containing hidden blocks; click to append one or drag its handle to a highlighted slot. The sidebar shows an empty state when all blocks are present. Arrow keys on a focused dashboard handle also move a block. **Done editing** hides the controls.

Block order and visibility are saved in this browser's local storage. Removing a block never stops its collection or deletes history. A new browser starts with all blocks visible.

Load averages are the OS-reported number of runnable or waiting tasks, not CPU percentages or values normalized by core count. The graph shows the host's logical core count for context. Temperature is reported in Celsius through `systeminformation.cpuTemperature()`. Sensor availability depends on the host; Raspberry Pi/Linux thermal sensors can be read directly, while macOS may require one of systeminformation's optional native sensor helpers. Sentinel does not install privileged helpers automatically. Unsupported sensors show **Unavailable**, and old history stays empty for newly added metrics.

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
bun run test:docker # requires a running Docker Engine
bun run test:docker:host # run on a Linux Docker Engine host
```

The first build or dev run generates TanStack Router's `src/routeTree.gen.ts`. The build emits client/server bundles used by `bun start`.

## Code

- `scripts/dev.ts` starts Vite and the collector together.
- `scripts/start.ts` serves the production build and starts the collector together.
- `src/server/` contains the platform adapter, configuration, and Bun SQLite store; these modules stay on the server.
- `src/routes/api.metrics.ts` exposes the read-only dashboard snapshot and history.
- `src/components/` contains the dashboard, Recharts graphs, and theme handling.
- `src/components/ui/` contains shadcn/ui components; `components.json` configures the CLI.

Platform support uses the operating system where Bun runs. Host-mode Compose reads the Linux host; ordinary containers describe their visible environment, not the macOS host. Core metrics need no root privileges; hardware temperature availability depends on the host's sensors, permissions, and optional utilities.

Implementation references: [TanStack Start setup](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch), [systeminformation](https://systeminformation.io), [Bun SQLite](https://bun.sh/docs/runtime/sqlite), and [shadcn/ui](https://ui.shadcn.com).
