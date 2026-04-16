# My Terminal

[English](README.md) | [中文](README.zh-CN.md)

Desktop SSH terminal built with Electron + React, including SFTP file management and remote system metrics.

## Highlights

- SSH terminal experience based on `xterm.js`
- SFTP file list, upload, download, batch transfer, and context actions
- Remote metrics panel (CPU / memory / network / disk / GPU)
- Session/folder management persisted with SQLite
- Frameless dark UI with configurable fonts/colors

## Tech Stack

- Electron
- React + Vite
- TypeScript
- `ssh2` + `ssh2-sftp-client`
- `xterm` + addons
- SQLite3

## Prerequisites

- Node.js 18+
- npm 9+
- Windows (current packaging target)

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Package (Unpacked)

```bash
npm run pack:unpacked
```

Output folder:

```text
release/win-unpacked
```

## Version

Current release version: `1.0.0`

## License

MIT
