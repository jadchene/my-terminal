# My Terminal

[English](README.md) | [中文](README.zh-CN.md)

My Terminal is a desktop SSH client built with Electron + React. It combines terminal sessions, SFTP file management, and remote system metrics in one local app.

## Features

- SSH terminal based on `xterm.js`
- Multiple tabs per server profile
- Session tree with folder grouping
- SFTP file browser
- SFTP batch upload/download (files and directories)
- Right-click context actions (rename/delete/download/edit)
- Remote metrics panel (CPU / memory / network / disk / GPU)
- Persistent app settings (theme, fonts, behavior, sidebar state)
- Local storage with SQLite

## Screens / Modules

- Top bar: window controls, app menu, sidebar toggle
- Left sidebar:
- Session tree tab
- SFTP tab
- Status metrics tab
- Main area: terminal tabs + terminal output
- In-app dialogs: session edit, confirmations, prompts, settings

## Tech Stack

- Electron
- React + Vite
- TypeScript
- `ssh2`
- `ssh2-sftp-client`
- `xterm` + addons
- SQLite3

## Requirements

- Node.js `>=18`
- npm `>=9`
- Windows (current target for packaging)

## Project Structure

```text
electron/          Electron main process + preload
src/               React renderer source
dist/              Renderer build output
dist-electron/     Main process build output
release/           Packaged output
user-data/         Runtime data (config, db, cache)
```

## Local Development

Install dependencies:

```bash
npm install
```

Start renderer + Electron together:

```bash
npm run dev
```

## Build

Build renderer and electron:

```bash
npm run build
```

## Package (Unpacked)

Generate unpacked package:

```bash
npm run pack:unpacked
```

Final output directory:

```text
release/my-terminal
```

Executable:

```text
release/my-terminal/my-terminal.exe
```

## Runtime Data

By default, runtime files are placed near the app runtime directory:

- `user-data/`
- `config.json`
- `app.db`

This design avoids forcing data into `C:\Users\<name>\AppData\Roaming`.

## Configuration

Settings include:

- UI font family + size
- Terminal font family + size
- Foreground/background colors
- Sidebar width and visibility
- Hidden files toggle for SFTP
- Default download directory

## Known Notes

- Packaging currently targets Windows.
- Some very large frontend chunks may trigger Vite size warnings during build.
- If old packaged output is locked by a running process, package to a new directory.

## Version

Current release version: `1.0.0`

## License

MIT. See [LICENSE](LICENSE).
