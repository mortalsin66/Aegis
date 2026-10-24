# Aegis

**[English](README.md) · [Русский](README.ru.md)**

A self-hosted Linux server management panel — a lightweight alternative to Cockpit / Portainer.
A dark interface focused on speed and everyday administration.

## Features

- **Dashboard** — live CPU, memory, disk and network metrics, with persistent history and charts.
- **Services** — manage systemd units: start, stop, restart and inspect status.
- **Processes** — list, search and terminate processes.
- **Files** — upload, edit, archive, extract, change permissions and ownership, and calculate folder sizes on demand.
- **Terminal** — xterm.js + tmux; tmux sessions survive page reloads.
- **Network** — interfaces, listening ports, firewall (ufw / iptables / firewalld), routes and DNS.
- **Containers** — Docker containers, images, volumes, networks and Compose stacks.
- **Users** — create accounts, manage sudo access and change passwords.
- **Logs** — inspect systemd logs.
- **Updates** — install apt system updates.
- **Security** — TOTP 2FA, password and port changes, session revocation and restricted setup when the default password is still in use.
- **Activity** — persistent administrative action log without request bodies or terminal input.
- **Interface** — English and Russian, with a responsive mobile layout.
- **Self-updates** — check this repository for new releases and update from the panel.

## Stack

| Layer | Technologies |
|-------|--------------|
| Backend | Node.js, Fastify, Socket.IO, systeminformation, node-pty |
| Frontend | Vue 3, Vite, Tailwind CSS, Chart.js, xterm.js |

## Requirements

- Ubuntu / Debian; the project has been tested on Ubuntu 26.04.
- Root access: the agent runs as root to administer the server.
- Approximately 500 MB of free disk space.
- Node.js 22 or newer and pnpm; the installer sets these up.

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/mortalsin66/Aegis/main/install.sh | sudo bash
```

The script clones the repository into `/opt/aegis`, installs Node.js 22, pnpm and build tools,
builds the frontend and configures the `aegis-agent` systemd service.

Open the panel at:

```text
http://<server-IP>:9000
```

**Username: `admin`.** The installer generates a random password and prints it at the end.
Reinstalling preserves the existing password. Change the port in **Settings → Panel port**;
the panel automatically adds the corresponding ufw rule.

## Updating

The panel checks this repository for releases every six hours. Open
**Settings → Panel update → Check → Update** to download, build and restart the panel.
Sign in again after the restart. [Latest release notes](RELEASE_NOTES.md) are available in
English and Russian; previous notes are stored in [docs/releases](docs/releases).

### Upgrading an older installation

Use the built-in update button. The agent entry point installs locked dependencies even when
the older updater only copies the new source files. This requires Node.js >=22 and working pnpm;
the standard installer already installed Node.js 22. Password, TOTP and port settings are preserved.
If the password is still `admin`, the setup token only permits replacing it with a password
of at least 12 characters.

Updates started from v1.1.0 or newer are built separately, checked, and switched by an independent
systemd job. A failed health check restores the previous version automatically. The latest backup
is kept in `.aegis-rollback`; do not remove it during an update. The first upgrade still runs
through the older updater, whose file copy is not atomic.

## Monitoring and administration

- **Folder sizes:** click **Calculate size** in the size column or **Folder sizes on this page**.
  Calculation includes nested files and does not block navigation. Permission errors are shown
  separately, not as zero bytes. At most two scans run concurrently.
- **Network traffic:** the dashboard, interface list and history chart automatically choose B/s,
  KB/s, MB/s or GB/s. Values describe server interface traffic, not only panel requests:
  ↓ received, ↑ sent.
- **History:** up to 24 hours of CPU, RAM, disk and network history is saved in
  `agent/.aegis-history.json` and survives restarts.
- **Activity:** the Activity page records administrative changes. Request bodies and terminal
  input are not stored.
- **Read-only account:** set `AEGIS_VIEWER_USER` and `AEGIS_VIEWER_PASSWORD` in the systemd environment,
  then restart the service. The observer can view monitoring, services and logs, but cannot modify
  the system, open a terminal, browse arbitrary files, read Compose configurations or inspect
  container environment variables.
- **Server profiles:** settings are saved in the current browser. Each panel opens separately with
  its own session; centralized multi-server administration is not implemented.

For internet access, use an HTTPS reverse proxy or a VPN. CORS is disabled by default; if the
frontend is hosted separately, set an explicit comma-separated `AEGIS_ALLOWED_ORIGINS` list.
The agent retains root privileges; a separate privileged helper is not implemented.

## Support the project

Aegis is free and open source. If it helps you, you can support development with USDT:

| Network | Token | Address |
|---------|-------|---------|
| TRC-20 (TRON) | USDT | `TT95SXdQrXMeob8pQqBbiP1kvTsqdqA4hW` |
| ERC-20 (Ethereum) | USDT | `0x3b1ae446f117dbd9053ef722b6e1f0d96cb6a7ef` |

> Send only USDT on TRC-20 (TRON) or ERC-20 (Ethereum). Using another network can result in lost funds.

You can also support the project through [GitHub Sponsors](https://github.com/sponsors/mortalsin66).
The in-panel Donate button and wallet addresses are configured in
[`web/src/lib/donate.ts`](web/src/lib/donate.ts).

## Project layout

```text
agent/       — REST + WebSocket agent; aegis-agent systemd service
web/         — SPA frontend; builds into web/dist
docs/releases/ — bilingual release notes
install.sh   — server installation and setup
```

## Optional environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `9000` | Panel port |
| `AEGIS_PASSWORD` | Generated by the installer | Initial password; a saved password hash takes precedence |
| `AEGIS_USER` | `admin` | Administrator username |
| `AEGIS_TOTP_SECRET` | Unset | TOTP secret for automated setup |
| `JWT_SECRET` | Random | JWT signing secret |
| `AEGIS_VIEWER_USER` | Unset | Read-only username |
| `AEGIS_VIEWER_PASSWORD` | Unset | Read-only password |
| `AEGIS_ALLOWED_ORIGINS` | Unset | Allowed frontend origins, separated by commas |

Set these with `Environment=...` in the `[Service]` section of
`/etc/systemd/system/aegis-agent.service`. Reload systemd and restart the service after changing its configuration.

## Development checks

```sh
cd agent
pnpm install --frozen-lockfile
pnpm test
node scripts/smoke.mjs
cd ../web
pnpm install --frozen-lockfile
pnpm build
```

Linux CI also checks folder sizes, real HTTP traffic, successful updates, build failures,
automatic rollback after a failed health check and legacy updater dependency migration.
New GitHub Releases are published only after main passes the checks.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the bilingual documentation and release-note convention.
