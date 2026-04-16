# My Terminal

[English](README.md) | [中文](README.zh-CN.md)

基于 Electron + React 的桌面 SSH 终端，集成 SFTP 文件管理和远程系统指标查看。

## 核心功能

- 基于 `xterm.js` 的 SSH 终端会话
- SFTP 文件列表、上传、下载、批量传输、右键操作
- 远程状态侧边栏（CPU / 内存 / 网络 / 磁盘 / GPU）
- 会话树与目录管理，SQLite 本地持久化
- 无边框纯黑风格界面，支持字体与颜色配置

## 技术栈

- Electron
- React + Vite
- TypeScript
- `ssh2` + `ssh2-sftp-client`
- `xterm` 及扩展
- SQLite3

## 环境要求

- Node.js 18+
- npm 9+
- Windows（当前打包目标）

## 开发启动

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 打包（Unpacked）

```bash
npm run pack:unpacked
```

输出目录：

```text
release/win-unpacked
```

## 版本

当前发布版本：`1.0.0`

## License

MIT
