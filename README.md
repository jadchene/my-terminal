# My Terminal

[English](README.md) | [中文](README.zh-CN.md)

My Terminal is a local desktop SSH client built with Electron, React, TypeScript, and Vite. It combines SSH terminal tabs, session management, SFTP file operations, and remote system metrics in one Windows-focused app.

## Features

- SSH terminal sessions powered by `xterm.js`.
- Multiple terminal tabs, including multiple connections to the same saved session.
- Session tree with folders and a configurable default session.
- SFTP browser with create, rename, delete, upload, download, and batch transfer support.
- Drag-and-drop upload and multi-file or directory transfer workflows.
- Remote metrics panel for CPU, memory, network, disk, system, and NVIDIA GPU data when available.
- Persistent settings for theme colors, fonts, terminal behavior, sidebar state, hidden files, and download directory.
- Local SQLite storage for sessions, folders, and app settings.
- Password storage through the OS credential store via `keytar` when "remember password" is enabled.

## Why Use It

- Keep terminal, SFTP, and server status in one local app instead of switching between separate tools.
- Store common SSH sessions and group them by folder.
- Use SFTP side-by-side with the active SSH session.
- Keep runtime data next to the app directory, which makes portable unpacked builds easier to inspect and back up.

## Quick Start

Install dependencies:

```bash
npm install
```

Start the renderer and Electron app together:

```bash
npm run dev
```

## Basic Usage

1. Create a session with name, host, port, username, and password.
2. Choose whether the password should be remembered in the OS credential store.
3. Open the session from the session tree to create a terminal tab.
4. Use the SFTP tab to browse and transfer files for the active session.
5. Use the Status tab to view remote metrics for the active or selected session.
6. Adjust fonts, colors, sidebar behavior, hidden-file display, and download directory from Settings.

## SSH and SFTP

Session records store the connection metadata in SQLite. Remembered passwords are migrated out of SQLite and stored through `keytar`; public session data returned to the renderer does not include the password.

SFTP operations require an active SSH session. Downloads use the configured default download directory when set, otherwise the OS downloads directory. Batch transfers emit progress events and can be cancelled while running.

## Remote Metrics

Remote metrics are collected over the active SSH connection. The app reads Linux system files and commands such as:

- `/proc/stat`
- `/proc/cpuinfo`
- `/proc/meminfo`
- `/proc/net/dev`
- `/proc/diskstats`
- `df`
- `hostname`
- `ip`
- `lscpu`
- `nvidia-smi` when available

Metrics are best-effort. Missing commands or unsupported remote systems may show partial or empty metrics while the SSH terminal and SFTP features continue to work.

## Runtime Data

In development, runtime data is stored in the project root. In packaged builds, it is stored next to the executable.

Default runtime files:

```text
app.db
user-data/window-state.json
```

This app intentionally avoids forcing its database and window state into `AppData/Roaming` for unpacked local use.

## Configuration

Settings are stored in SQLite under the `app_setting` table.

Configurable areas:

- UI background and foreground colors
- UI and terminal font family and size
- Terminal cursor style, blink, and width
- Auto-copy selection
- Right-click paste
- Multi-line paste warning
- Default download directory
- Single-instance behavior
- Optional input-method switch behavior
- Sidebar visibility and width
- SFTP panel visibility
- Hidden files display

## Development

```bash
npm install
npm run dev
```

Build renderer and Electron main process:

```bash
npm run build
```

Run the built Electron entry:

```bash
npm start
```

## Packaging

Create an unpacked Windows build:

```bash
npm run pack:unpacked
```

Output:

```text
release/my-terminal/my-terminal.exe
```

If a previous packaged executable is still running, close it before packaging so the output directory can be replaced.

## License

MIT. See [LICENSE](LICENSE).
