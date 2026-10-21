# Add Sentinel to a project's Docker Compose setup

Sentinel can run alongside your application as a Docker Compose service. On a Linux Docker Engine host, it collects host CPU, memory, disk, network, and process metrics, even when the dashboard is closed. It monitors the machine hosting your project; it does not provide per-container resource accounting or application-specific metrics.

The example below uses the same service as the repository's [compose.yml](../compose.yml). Keep it in a separate `compose.sentinel.yml` file so you can add it to an existing deployment without replacing your application's Compose file. No changes to your application code are required.

Docker on macOS reports its Linux VM. To monitor the Mac itself, [run Sentinel natively with Bun](../README.md#run-locally).

## 1. Add the service

From the directory containing your project's `compose.yml`, download the service definition:

```sh
curl -fsSLo compose.sentinel.yml https://raw.githubusercontent.com/nagy135/sentinel/master/compose.yml
```

The file contains:

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

The shared network, PID, and hostname namespaces let Sentinel observe the Linux host. Read-only `/host` and `/sys` mounts expose host filesystem and system information. The service runs as non-root without privileged mode or access to the Docker socket. Only `/data`, which holds metrics and login sessions, uses a writable named volume.

You can instead merge the `sentinel` service and `sentinel_data` volume into your existing Compose file. In that case, omit `-f compose.yml -f compose.sentinel.yml` from the commands below. If your application already defines either name, rename the Sentinel service or volume consistently before combining the files.

## 2. Configure credentials and the dashboard port

Create or edit `.env` beside your project's `compose.yml`, preserving any existing application settings. Add:

```dotenv
SENTINEL_USERNAME=admin
SENTINEL_PASSWORD=replace-with-a-long-unique-password
SENTINEL_PORT=3100
SENTINEL_INTERVAL_MS=5000
```

Replace the example password before starting. Keep `.env` out of Git and restrict access with `chmod 600 .env`. Compose reads these values and passes the listed settings to Sentinel; your application does not need them.

This example chooses port **3100** to leave port 3000 available for your app. Pick another unused host port if needed. The service uses host networking, so `SENTINEL_PORT` controls its listening port directly; do not add a `ports` mapping. Collection runs every five seconds by default, independently of dashboard refreshes.

## 3. Start Sentinel alongside your application

Use both Compose files, with your application's file first:

```sh
docker compose -f compose.yml -f compose.sentinel.yml config --quiet
docker compose -f compose.yml -f compose.sentinel.yml pull sentinel
docker compose -f compose.yml -f compose.sentinel.yml up -d sentinel
docker compose -f compose.yml -f compose.sentinel.yml ps sentinel
docker compose -f compose.yml -f compose.sentinel.yml logs --tail=100 sentinel
```

These commands start the Sentinel service. To bring up the whole project, run the same `up -d` command without the final `sentinel`. If your application uses a different Compose filename or additional override files, keep those in the command and append `-f compose.sentinel.yml`. Keep the same project name (`-p`, if you use one) across commands so they address the same services and volumes.

Open **http://127.0.0.1:3100** on the Docker host and log in with the credentials from `.env`. The image health check verifies that collected samples are fresh.

For a remote server, forward the dashboard to your computer:

```sh
ssh -L 3100:127.0.0.1:3100 user@your-server
```

Then open **http://127.0.0.1:3100** locally. The default service listens only on the host's loopback interface.

For an HTTPS reverse proxy, set `SENTINEL_PUBLIC_URL=https://status.example.com` in `.env` and recreate the service with `up -d sentinel`. A proxy running on the host can forward to `http://127.0.0.1:3100`. A proxy container on a bridge network cannot reach Sentinel through its own `127.0.0.1`; configure its access to the host separately.

## 4. Update and keep history

To choose a release, add `SENTINEL_IMAGE=viktornagy/sentinel:<version>` to `.env`, replacing `<version>` with the release tag. Then pull and recreate only Sentinel:

```sh
docker compose -f compose.yml -f compose.sentinel.yml pull sentinel
docker compose -f compose.yml -f compose.sentinel.yml up -d sentinel
```

The `sentinel_data` volume preserves metrics and login sessions across container restarts and replacements. Back it up as part of your project's persistent data. Keep the Compose project name stable to reuse the same volume.

To stop monitoring without stopping the application:

```sh
docker compose -f compose.yml -f compose.sentinel.yml stop sentinel
```

`docker compose down` affects the whole combined project. Adding `--volumes` also deletes its named volumes, including Sentinel history and any application volumes managed by that project.

For standalone installation, the ordinary-container variant, and all environment settings, see the [README](../README.md#docker-compose-linux-host-monitoring).
