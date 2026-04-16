# My Terminal

[中文文档](README.zh-CN.md)

An Electron-based SSH terminal application featuring SFTP file transfer and system monitoring capabilities.

## Features

- **SSH Terminal:** Fully functional terminal emulator powered by `xterm.js`.
- **SFTP Support:** Easy file transfers via SFTP using `ssh2-sftp-client`.
- **System Monitoring:** Built-in system stats and monitoring integration.
- **Local Storage:** SQLite integration for secure and local data storage.

## Tech Stack

- **Framework:** Electron, React, Vite
- **Language:** TypeScript
- **Terminal:** xterm.js
- **SSH/SFTP:** ssh2, ssh2-sftp-client
- **Database:** SQLite3

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build the application
npm run build
```

## License

MIT
