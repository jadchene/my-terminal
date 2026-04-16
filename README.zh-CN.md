# My Terminal

[English](README.md) | [中文](README.zh-CN.md)

My Terminal 是一个基于 Electron + React 的桌面 SSH 客户端，整合了终端会话、SFTP 文件管理和远程状态监控。

## 功能概览

- 基于 `xterm.js` 的 SSH 终端
- 同一连接支持多标签会话
- 会话树和目录分组管理
- SFTP 文件浏览
- SFTP 批量上传/下载（文件和目录）
- 右键菜单操作（重命名、删除、下载、编辑）
- 远程状态面板（CPU / 内存 / 网络 / 磁盘 / GPU）
- 应用设置持久化（主题、字体、行为、侧边栏状态）
- SQLite 本地数据存储

## 界面模块

- 顶栏：窗口控制、菜单、侧边栏显示切换
- 左侧边栏：
- 会话树标签
- SFTP 标签
- 状态标签
- 主区域：终端标签页和终端输出
- 内置弹窗：会话编辑、确认框、输入框、设置

## 技术栈

- Electron
- React + Vite
- TypeScript
- `ssh2`
- `ssh2-sftp-client`
- `xterm` 及扩展
- SQLite3

## 环境要求

- Node.js `>=18`
- npm `>=9`
- Windows（当前打包目标）

## 目录结构

```text
electron/          Electron 主进程与 preload
src/               React 渲染进程源码
dist/              渲染进程构建产物
dist-electron/     主进程构建产物
release/           打包输出目录
user-data/         运行时数据（配置、数据库、缓存）
```

## 本地开发

安装依赖：

```bash
npm install
```

启动开发模式（渲染进程 + Electron）：

```bash
npm run dev
```

## 构建

构建渲染进程与主进程：

```bash
npm run build
```

## 打包（Unpacked）

生成 unpacked 包：

```bash
npm run pack:unpacked
```

最终输出目录：

```text
release/my-terminal
```

可执行文件：

```text
release/my-terminal/my-terminal.exe
```

## 运行时数据

默认运行时文件会放在应用运行目录附近：

- `user-data/`
- `config.json`
- `app.db`

该策略用于避免强制写入 `C:\Users\<用户名>\AppData\Roaming`。

## 配置项

支持以下配置：

- 界面字体和字号
- 会话字体和字号
- 前景色/背景色
- 侧边栏宽度与显示状态
- SFTP 隐藏文件开关
- 默认下载目录

## 注意事项

- 当前只针对 Windows 进行打包。
- 前端体积较大时，Vite 可能出现 chunk size 警告。
- 若旧打包目录被占用，可改用新目录重新打包。

## 版本

当前发布版本：`1.0.0`

## 许可证

MIT，详见 [LICENSE](LICENSE)。
