# My Terminal

[English](README.md) | [中文](README.zh-CN.md)

My Terminal 是一个本地桌面 SSH 客户端，基于 Electron、React、TypeScript 和 Vite 构建。它把 SSH 终端标签页、会话管理、SFTP 文件操作和远程系统指标集中在一个以 Windows 为主要目标的应用里。

## 功能

- 基于 `xterm.js` 的 SSH 终端会话。
- 支持多个终端标签页，也支持对同一个保存会话打开多个连接。
- 带文件夹分组和默认会话设置的会话树。
- SFTP 文件浏览器，支持创建、重命名、删除、上传、下载和批量传输。
- 支持拖拽上传，以及多文件/目录传输流程。
- 远程状态面板，展示 CPU、内存、网络、磁盘、系统信息，以及可用时的 NVIDIA GPU 数据。
- 持久化设置，包括主题颜色、字体、终端行为、侧边栏状态、隐藏文件显示和下载目录。
- 使用本地 SQLite 保存会话、文件夹和应用设置。
- 启用“记住密码”时，通过 `keytar` 把密码保存到操作系统凭据存储。

## 为什么使用它

- 把终端、SFTP 和服务器状态放在一个本地应用里，减少在多个工具之间切换。
- 保存常用 SSH 会话，并按文件夹分组。
- 在当前 SSH 会话旁边直接使用 SFTP。
- 运行时数据放在应用目录附近，方便检查、备份和使用 unpacked 便携构建。

## 快速开始

安装依赖：

```bash
npm install
```

同时启动渲染端和 Electron 应用：

```bash
npm run dev
```

## 基本使用

1. 创建会话，填写名称、主机、端口、用户名和密码。
2. 选择是否把密码记住到操作系统凭据存储。
3. 从会话树打开会话，创建终端标签页。
4. 在 SFTP 标签中浏览和传输当前会话的文件。
5. 在 Status 标签中查看当前或选中会话的远程指标。
6. 在 Settings 中调整字体、颜色、侧边栏行为、隐藏文件显示和下载目录。

## SSH 与 SFTP

会话记录把连接元数据保存在 SQLite。被记住的密码会迁移出 SQLite，并通过 `keytar` 保存；返回给渲染进程的公开会话数据不包含密码。

SFTP 操作需要一个已连接的 SSH 会话。下载会优先使用配置的默认下载目录，否则使用系统下载目录。批量传输会发送进度事件，并支持运行中取消。

## 远程指标

远程指标通过当前 SSH 连接采集。应用会读取 Linux 系统文件和命令，例如：

- `/proc/stat`
- `/proc/cpuinfo`
- `/proc/meminfo`
- `/proc/net/dev`
- `/proc/diskstats`
- `df`
- `hostname`
- `ip`
- `lscpu`
- `nvidia-smi`（可用时）

指标采集是尽力而为的。缺少命令或远程系统不支持时，可能只显示部分指标或空指标，但 SSH 终端和 SFTP 功能仍可继续使用。

## 运行时数据

开发模式下，运行时数据保存在项目根目录。打包后，运行时数据保存在可执行文件旁边。

默认运行时文件：

```text
app.db
user-data/window-state.json
```

应用有意不把数据库和窗口状态强制写入 `AppData/Roaming`，方便 unpacked 本地使用。

## 配置项

设置保存在 SQLite 的 `app_setting` 表中。

可配置内容：

- UI 背景色和前景色
- UI 与终端字体、字号
- 终端光标样式、闪烁和宽度
- 选择文本后自动复制
- 右键粘贴
- 多行粘贴警告
- 默认下载目录
- 单实例行为
- 可选输入法切换行为
- 侧边栏显示状态和宽度
- SFTP 面板显示状态
- 隐藏文件显示

## 开发

```bash
npm install
npm run dev
```

构建渲染端和 Electron 主进程：

```bash
npm run build
```

运行构建后的 Electron 入口：

```bash
npm start
```

## 打包

创建 Windows unpacked 构建：

```bash
npm run pack:unpacked
```

输出：

```text
release/my-terminal/my-terminal.exe
```

如果上一次打包出来的可执行文件仍在运行，请先关闭它，再重新打包，确保输出目录能被替换。

## License

MIT. See [LICENSE](LICENSE).
