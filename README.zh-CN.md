# My Terminal

[English Version](README.md)

基于 Electron 构建的 SSH 终端应用，集成了 SFTP 文件传输以及系统监控功能。

## 功能特性

- **SSH 终端：** 采用 `xterm.js` 构建的全功能终端模拟器。
- **SFTP 支持：** 使用 `ssh2-sftp-client` 实现便捷的文件传输。
- **系统监控：** 内置系统状态监控与信息获取功能。
- **本地存储：** 集成 SQLite3 实现安全的本地数据存储。

## 技术栈

- **框架：** Electron, React, Vite
- **语言：** TypeScript
- **终端：** xterm.js
- **SSH/SFTP:** ssh2, ssh2-sftp-client
- **数据库：** SQLite3

## 开发指南

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建应用
npm run build
```

## 开源协议

MIT
