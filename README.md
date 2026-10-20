# Sentinel

Self-hosted Linux/macOS system metrics with automatic host detection, live graphs, and SQLite history. Built with Bun, TanStack Start, React, TypeScript, and `systeminformation`.

## Run locally

Requires [Bun](https://bun.sh) 1.4.2. The server and collector start together; collection continues without an open browser.

```sh
bun install
cp .env.example .env # set SENTINEL_USERNAME and SENTINEL_PASSWORD privately
bun run dev

# Production
bun run build
bun start
```

Open **http://127.0.0.1:3000**. Login is required; native runs bind to localhost by default. For production, keep `SENTINEL_DB_PATH` outside the checkout.

## Docker Compose (Linux host monitoring)

[Docker Hub](https://hub.docker.com/r/viktornagy/sentinel): `viktornagy/sentinel:v0.3.0` (Compose default) or `latest`, for AMD64 and ARM64.

```sh
mkdir sentinel && cd sentinel
curl -fsSLo compose.yml https://raw.githubusercontent.com/nagy135/sentinel/master/compose.yml
${EDITOR:-vi} .env # set SENTINEL_USERNAME and SENTINEL_PASSWORD
chmod 600 .env
docker compose pull
docker compose up -d
```

[compose.yml](compose.yml) monitors the Linux host using shared network/PID/hostname namespaces and read-only `/host` and `/sys` mounts. It runs as non-root, without privileged mode or a Docker socket. The dashboard listens on **127.0.0.1:3000**; use a reverse proxy or `ssh -L 3000:127.0.0.1:3000 user@host` for remote access.

Create `.env` beside the Compose file to override `SENTINEL_IMAGE`, `SENTINEL_PORT` (default `3000`), or `SENTINEL_INTERVAL_MS` (default `5000`). To update, repeat `pull` and `up -d`; inspect with `docker compose logs --tail=100 sentinel` or `docker compose ps`. The health check verifies fresh collected samples.

History persists in `sentinel_data:/data`. **`docker compose down --volumes` deletes it**; ordinary `down` keeps it.

For an ordinary container, use [compose.container.yml](compose.container.yml) with `docker compose -f compose.container.yml up -d`. It reports the visible Linux environment, not per-container resource accounting. Docker on macOS reports its Linux VM; run Bun natively to monitor the Mac. Stop the old Compose variant before switching; both share the data volume.

Build from a source checkout:

```sh
docker build -t sentinel:local .
SENTINEL_IMAGE=sentinel:local docker compose up -d --pull never
```

## Login

**Authentication requires v0.2.0 or newer; v0.1.0 does not enforce login.**

Set **`SENTINEL_USERNAME`** and **`SENTINEL_PASSWORD`** in a private environment file before starting; missing values prevent startup. Never commit this file. Compose requires both variables in its adjacent `.env`. For an HTTPS reverse proxy, also set `SENTINEL_PUBLIC_URL=https://your-domain` so origin checks and Secure cookies use the external URL.

The dashboard and metrics API require login. The browser stores an opaque **HttpOnly, SameSite** cookie, never your password; HTTPS adds Secure. Its 400-day lifetime renews automatically during use. Sessions persist through restarts/upgrades in `<SENTINEL_DB_PATH>.auth.sqlite`, containing hashed session tokens and an Argon2id password hash. Keep this file with the metrics database. Changing either credential revokes existing sessions on restart; signing out revokes that browser's session. Clearing cookies, switching browsers, or browser storage expiry also requires login. `/healthz` exposes only service health.

For nixpi's native systemd service, the private file is **`/etc/sentinel/credentials.env`**, owned by root with mode `0600`; the Nix service loads it through `EnvironmentFile`. Put only the two credential variables there. `SENTINEL_PUBLIC_URL` is configured in Nix. Edit credentials directly on the host, outside Git and the Nix store.

## Configuration

For native runs, copy [.env.example](.env.example) to `.env` or pass environment variables. Restart after changing settings.

| Variable               | Native default           | Purpose                                                                                                         |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | `3000`                   | Dashboard port. Compose uses `SENTINEL_PORT`.                                                                   |
| `SENTINEL_INTERVAL_MS` | `5000`                   | Collection interval in ms; integer ≥ 1000.                                                                      |
| `SENTINEL_DB_PATH`     | `./data/sentinel.sqlite` | SQLite path; Compose uses `/data/sentinel.sqlite`.                                                              |
| `SENTINEL_HOST`        | `127.0.0.1`              | Bind address: `127.0.0.1` or `0.0.0.0`. The image defaults to the latter; host-mode Compose restores localhost. |
| `SENTINEL_USERNAME`    | Required                 | Login username.                                                                                                 |
| `SENTINEL_PASSWORD`    | Required                 | Login password; keep private.                                                                                   |
| `SENTINEL_PUBLIC_URL`  | Request origin           | External HTTP(S) origin; set for HTTPS proxies.                                                                 |
| `SENTINEL_HOST_ROOT`   | Unset                    | Read-only Linux host root; host-mode Compose sets `/host`.                                                      |

## Dashboard & history

- CPU total/per-core activity, active RAM and swap, filesystems, network rates/interfaces, uptime, 1/5/15-minute load averages, and CPU temperature in °C when available.
- Presets from 15 minutes to all history, custom local-time ranges, and synchronized drag-to-zoom. **Undo zoom** steps back; **Reset to live** restores the preset; Escape cancels a selection.
- **Top processes · CPU / Memory**: five lines by highest recorded peak in the selected range, recalculated on zoom, labelled by name and PID. Add them through **Edit dashboard → Add blocks** on an existing layout.
- **Edit dashboard** reveals remove buttons and drag handles. **Add blocks** restores hidden blocks by click or drag; arrow keys on handles also reorder. Layout and System/Light/Dark preferences persist in the browser.

All raw samples remain in SQLite; charts average approximately 360 buckets per range and query raw detail again when zoomed. Hiding blocks or changing ranges never stops collection or deletes data. No automatic retention limit is applied.

Process history saves the union of the top **20 CPU and 20 memory** processes per interval (at most 40), with both percentages for each. CPU is a share of total machine capacity; memory is resident RAM / physical RAM (shared pages can overlap). Only executable names, PIDs, and metrics are stored, without command arguments. Process start identities separate reused PIDs. Process charts use bucket **peaks**, show partial sample coverage in tooltips, and recover individual readings/gaps when zoomed. Missing readings stay unknown; older history has no process data. The first CPU observation needs a baseline, and processes that finish between samples can be missed. macOS CPU is the OS's recent-use estimate; Linux uses interval deltas.

Unavailable sensors/readings stay unavailable, including network rates until two samples exist. Load is not a percentage; memory excludes reclaimable cache. APFS capacities are never summed. Network totals include virtual interfaces, so forwarded traffic can be counted more than once. macOS temperature may require an optional native sensor helper.

Authenticated metrics API: `GET /api/metrics?range=1h` (presets: `15m`, `1h`, `6h`, `24h`, `7d`, `all`), or `?range=custom&from=<epoch-ms>&to=<epoch-ms>` with inclusive bounds. Invalid ranges return 400.

## Image releases

The [publishing workflow](.github/workflows/publish-docker.yml) follows [mongo-backup](https://github.com/nagy135/mongo-backup): version tags contained in `master` run production and Compose tests, then publish the exact tag and `latest` for AMD64/ARM64. Non-version tags and commits outside `master` are skipped; every eligible version updates `latest`.

Set the GitHub repository secret `DOCKERHUB_TOKEN` to a token with write access to `viktornagy/sentinel`, then tag a new version:

```sh
git switch master && git pull --ff-only
git tag v0.3.0
git push origin v0.3.0
```

## Development

```sh
bun run typecheck
bun run test:production  # build + tests
bun run test:docker      # Docker Engine required
bun run test:docker:host # Linux Docker Engine host required
```

[scripts/](scripts/) contains the runners and smoke tests; [src/server/](src/server/) handles collection/storage; [src/components/](src/components/) contains the dashboard and UI.
