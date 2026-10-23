# Sentinel

Sentinel is a self-hosted system monitoring dashboard for Linux and macOS. It collects metrics in the background, displays live readings and historical charts, and stores history locally in SQLite. No separate database service is required.

![Sentinel system overview dashboard](docs/images/dashboard.png)

- CPU activity, RAM and swap usage, filesystems, network traffic, uptime, load averages, and CPU temperature when available.
- Historical CPU and memory charts for the busiest processes.
- Time presets, custom ranges, and synchronized chart zoom.
- Customizable dashboard layout, colors, light/dark themes, and refresh interval.
- Password-protected dashboard and metrics API. Collection continues when the browser is closed.

Built with Bun, TanStack Start, React, TypeScript, and `systeminformation`. Run it directly on the machine you want to monitor, or add it to a Linux project's Docker Compose deployment.

## Build and run with the Dockerfile

Clone the project on your Linux server and build the included Dockerfile. Docker installs Bun and the application dependencies inside the image; the server needs Git and Docker Engine.

```sh
git clone https://github.com/nagy135/sentinel.git
cd sentinel
docker build -t sentinel:local .
```

Create `.env` in the checkout with your own credentials:

```dotenv
SENTINEL_USERNAME=admin
SENTINEL_PASSWORD=replace-with-a-long-unique-password
```

Replace the example password, keep `.env` out of Git, and run:

```sh
chmod 600 .env
docker volume create sentinel_data
docker run -d \
  --name sentinel \
  --restart unless-stopped \
  --init \
  --network host \
  --pid host \
  --uts host \
  --env-file .env \
  --env PORT=3100 \
  --env SENTINEL_HOST=127.0.0.1 \
  --env SENTINEL_HOST_ROOT=/host \
  --env SENTINEL_DB_PATH=/data/sentinel.sqlite \
  --mount type=volume,source=sentinel_data,target=/data \
  --mount type=bind,source=/,target=/host,readonly,bind-propagation=rslave \
  --mount type=bind,source=/sys,target=/sys,readonly \
  sentinel:local
docker logs --tail=100 sentinel
```

This monitors the Linux host using shared network, PID, and hostname namespaces and read-only host mounts. It runs as non-root, without privileged mode or a Docker socket. The named volume stores metrics and login sessions across container replacements; `--restart unless-stopped` starts the container again after a server reboot when Docker starts.

Open **http://127.0.0.1:3100** on the server and log in. The dashboard listens only on localhost. For a remote server, run this on your computer and then open that same local URL:

```sh
ssh -L 3100:127.0.0.1:3100 user@your-server
```

To deploy a rebuilt image, run `docker build -t sentinel:local .` again, remove the old container with `docker stop sentinel` and `docker rm sentinel`, then repeat the `docker run` command. Keep `sentinel_data` to preserve history.

## Add Sentinel to Docker Compose

This setup monitors the **Linux host running your project**, including host processes and filesystems. It does not provide per-container resource accounting or application-specific metrics. Docker on macOS exposes its Linux VM; use the source setup below to monitor the Mac itself.

### 1. Add the service

Add `sentinel` under your existing `services` section and `sentinel_data` under your top-level `volumes` section. Keep your application's existing services and volumes. The following also works as a standalone `compose.yml`:

```yaml
services:
  sentinel:
    image: ${SENTINEL_IMAGE:-viktornagy/sentinel:v0.3.1}
    restart: unless-stopped
    init: true
    network_mode: host
    pid: host
    uts: host
    environment:
      SENTINEL_USERNAME: ${SENTINEL_USERNAME:?Set SENTINEL_USERNAME in .env}
      SENTINEL_PASSWORD: ${SENTINEL_PASSWORD:?Set SENTINEL_PASSWORD in .env}
      SENTINEL_PUBLIC_URL: ${SENTINEL_PUBLIC_URL:-}
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

This is the service supplied in the repository's `compose.yml`. It uses shared network, PID, and hostname namespaces plus read-only host mounts to collect Linux host metrics. It runs as non-root, without privileged mode or a Docker socket. History and login sessions persist in `sentinel_data`.

### 2. Set credentials and a port

Add these values to `.env` beside your project's Compose file, preserving any existing application settings:

```dotenv
SENTINEL_USERNAME=admin
SENTINEL_PASSWORD=replace-with-a-long-unique-password
SENTINEL_PORT=3100
SENTINEL_INTERVAL_MS=5000
```

Replace the password and keep `.env` private with `chmod 600 .env`. Port **3100** leaves port 3000 available for your app; choose another unused port if needed. The service uses host networking, so do not add a `ports` mapping. Without `SENTINEL_PORT`, it defaults to 3000.

### 3. Start and open the dashboard

From your project's directory:

```sh
docker compose config --quiet
docker compose pull sentinel
docker compose up -d sentinel
docker compose ps sentinel
docker compose logs --tail=100 sentinel
```

These commands start Sentinel alongside your existing application. To start the whole project, use `docker compose up -d` without the service name. The published image supports AMD64 and ARM64.

Open **http://127.0.0.1:3100** on the Docker host and log in with your credentials. The dashboard listens only on the host's loopback interface. For a remote server, run this on your computer, then open the same local URL:

```sh
ssh -L 3100:127.0.0.1:3100 user@your-server
```

For an HTTPS reverse proxy, set `SENTINEL_PUBLIC_URL=https://status.example.com` in `.env` and rerun `docker compose up -d sentinel`. A proxy on the host can forward to `http://127.0.0.1:3100`. A proxy in a bridge-network container needs access to the host; its own `127.0.0.1` points to that proxy container.

### Use the image you built

To use the local image from the Dockerfile setup above, set `SENTINEL_IMAGE=sentinel:local` in your deployment project's `.env` on the same Docker Engine. Then run from that project's directory:

```sh
docker compose up -d --pull never sentinel
```

### Updates and stored data

To use a published release, set `SENTINEL_IMAGE=viktornagy/sentinel:<version>` in `.env`, replacing `<version>` with the release tag. Then run:

```sh
docker compose pull sentinel
docker compose up -d sentinel
```

The named volume keeps metrics and login sessions through container restarts and replacements. Keep the Compose project name stable to reuse it. Stop monitoring with `docker compose stop sentinel`. **`docker compose down --volumes` deletes the combined project's named volumes, including Sentinel history and application data.**

## Run from source

Requires Bun **1.4.2** on Linux or macOS. Clone the repository if you have not already, then work from its directory:

```sh
git clone https://github.com/nagy135/sentinel.git
cd sentinel
bun install --frozen-lockfile
```

Create a private `.env` with `SENTINEL_USERNAME` and `SENTINEL_PASSWORD`, as shown in the Dockerfile setup, then build and start:

```sh
chmod 600 .env
bun run build
bun start
```

Open **http://127.0.0.1:3000** and log in. For development, use `bun run dev` instead of the production build and start commands. The server and collector run together. History defaults to `./data/sentinel.sqlite`; for production, set `SENTINEL_DB_PATH` to a persistent location outside the checkout.

## Configuration and login

Docker loads credentials through `--env-file .env`; Compose passes the variables listed in the service definition. Bun reads `.env` automatically for native runs. Restart or recreate Sentinel after changing settings.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SENTINEL_USERNAME` | Required | Dashboard and API login username. |
| `SENTINEL_PASSWORD` | Required | Login password; missing credentials prevent startup. |
| `PORT` | `3000` | Native server port. |
| `SENTINEL_PORT` | `3000` | Host port for the Compose service above. |
| `SENTINEL_IMAGE` | `viktornagy/sentinel:v0.3.1` | Image used by Compose. |
| `SENTINEL_INTERVAL_MS` | `5000` | Collection interval in milliseconds; integer of at least 1000. Independent of browser refresh. |
| `SENTINEL_DB_PATH` | `./data/sentinel.sqlite` | Native SQLite path; Compose sets `/data/sentinel.sqlite`. |
| `SENTINEL_HOST` | `127.0.0.1` | Native bind address; accepts `127.0.0.1` or `0.0.0.0`. The Compose example also binds to localhost. |
| `SENTINEL_PUBLIC_URL` | Request origin | External HTTP(S) origin, such as `https://status.example.com`, for reverse proxies. |
| `SENTINEL_HOST_ROOT` | Unset | Linux host filesystem mount; the Compose service sets `/host`. |
| `SENTINEL_DEBUG_PERF` | Unset | Set to `1` temporarily to log request, SQLite query, collection, and browser timings. |

Login sessions persist in `<SENTINEL_DB_PATH>.auth.sqlite`; back it up with the metrics database. Changing either credential revokes existing sessions on restart. HTTPS enables Secure cookies. `/healthz` exposes service health without login.

History has no automatic retention limit, so allow disk space for continued collection. Hiding dashboard blocks or changing the displayed time range does not delete data. Sensor availability depends on the host; missing readings remain unavailable.

With `SENTINEL_DEBUG_PERF=1`, structured `[sentinel:perf]` logs include the selected range, stored sample count, database and response size, CPU time, memory usage, and timings for each dashboard query and collection sensor. Visible dashboard tabs automatically report loading, JSON parsing, DOM commit, and a two-frame paint-wait estimate to the same authenticated API. Match `metrics` and `browser` entries by `requestId`. Query timings are nested within the request total; sensor timings overlap because collection runs concurrently. Browser frame timing is an estimate, and browser reports may be absent if a tab is hidden or closed before reporting. Disable the flag and restart after collecting a reproduction. Compose deployments must also pass this variable through the service's `environment` section.

## Development checks

```sh
bun run typecheck
bun run test:production   # build and test the production server
bun run test:docker       # requires Docker Engine
bun run test:docker:host  # requires Docker Engine on Linux
```

For slower hosts, use `SENTINEL_TEST_STARTUP_TIMEOUT_MS=60000 bun run test:production` to allow more time for service startup and the restart smoke test. The behavior assertions remain the same.

## Investigate load spikes (Linux)

The **Load incident recorder** runs automatically on Linux, independently of the browser and the regular `SENTINEL_INTERVAL_MS` setting. It samples `/proc` about once a second, without running commands or recording process arguments or environment variables. On macOS, regular monitoring continues and the recorder reports that Linux diagnostics are unavailable.

The recorder collects:

- Instantaneous runnable/blocked task counts and the one-minute load average.
- CPU, memory, and I/O pressure (PSI), calculated from cumulative stall-time deltas; CPU busy, I/O wait, and steal time.
- Swap-in/out rates in pages per second and major page faults per second.
- Per-device read/write throughput, average completed-I/O latency, average queue depth, and in-flight requests. Devices and partitions can overlap and are never added together.
- Threads observed in uninterruptible sleep (D state), including threads whose process leader is sleeping and workloads outside the top CPU/memory lists. Readable kernel wait locations and raw cgroup membership help identify the affected service or container. Thread identities include boot ID and start time to distinguish reused IDs.

A recording starts when at least two tasks are blocked, the run queue or one-minute load exceeds twice the logical core count, or interval PSI `some` reaches 25% for CPU or 10% for memory/I/O. Further triggers extend the same recording until two minutes after the last trigger. Continuous incidents are capped at ten minutes, followed by a one-minute cooldown before another recording can start.

Click a point in **System load**, or follow **Inspect incidents**, to inspect a saved recording. The incident charts zoom together; clicking a point or choosing a sample shows that moment's disk activity and blocked threads. The thread table ranks repeated observations, not exact blocked durations. **Show window in dashboard** aligns the ordinary charts with the recording. A blocked workload is not necessarily the cause of contention, and sampling cannot capture every short-lived task or establish every root cause.

The pre-trigger buffer holds up to five minutes / 300 readings / 4 MiB in memory. Saved diagnostics are retained in the existing SQLite database, with limits of seven days, 50 incidents, 4 MiB of reading JSON per incident, and 32 MiB overall. Oldest readings are trimmed first when byte limits are reached, so the displayed retained window can be shorter than requested. These are payload limits; SQLite pages and WAL files add overhead. Ordinary metric history is unaffected. Recordings survive restarts; unfinished recordings are marked **interrupted**.

Collection is best effort with the existing non-root Docker setup. Missing PSI support, restricted task access, hidden wait symbols, and truncated details are reported in **Collection limits**; unavailable values remain unknown. Task details are capped at 200 blocked threads and disk details at 128 devices per reading. All threads are scanned, so large hosts can take longer than a second; collection duration and timeline gaps remain visible. The recorder does not require privileged mode or a Docker socket. Raw cgroup paths are shown as observed and may be limited by the host's cgroup namespace configuration.
