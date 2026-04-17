import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';
import sqlite3 from 'sqlite3';
import keytar from 'keytar';
import { get } from './db';
import { sshStateMap, connectionSessionMap, connectionHomeMap, pendingCwdProbeMap, pendingPwdCaptureMap, lastKnownCwdMap } from './state';

export function clearPendingCwdProbe(connectionId: number, error?: Error) {
  const pending = pendingCwdProbeMap.get(connectionId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingCwdProbeMap.delete(connectionId);
  if (error) {
    pending.reject(error);
  }
}

export function clearPendingPwdCapture(connectionId: number, error?: Error) {
  const pending = pendingPwdCaptureMap.get(connectionId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingPwdCaptureMap.delete(connectionId);
  if (error) {
    pending.reject(error);
  }
}

export function stripAnsi(input: string): string {
  return input.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '');
}

export function resolveHomeToken(connectionId: number, tokenPath: string): string {
  const session = connectionSessionMap.get(connectionId);
  const fallbackHome = session?.username === 'root' ? '/root' : session?.username ? `/home/${session.username}` : '/';
  const home = connectionHomeMap.get(connectionId) || fallbackHome;
  if (tokenPath === '~') return home;
  if (tokenPath.startsWith('~/')) return path.posix.normalize(path.posix.join(home, tokenPath.slice(2)));
  return tokenPath;
}

export function updateCwdFromPrompt(connectionId: number, shellChunk: string) {
  const clean = stripAnsi(shellChunk);
  const lines = clean.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const matched = line.match(/\[[^\]\r\n]*?\s([~\/][^\]\r\n]*)\]\s*[#$]\s*$/);
    if (!matched?.[1]) continue;
    const cwd = resolveHomeToken(connectionId, matched[1].trim());
    if (cwd) {
      lastKnownCwdMap.set(connectionId, cwd);
    }
  }
}

export function processShellDataForPwdCapture(connectionId: number, shellChunk: string) {
  const pending = pendingPwdCaptureMap.get(connectionId);
  if (!pending) return;
  const clean = stripAnsi(shellChunk);
  pending.buffer += `\n${clean}`;
  if (pending.buffer.length > 20000) {
    pending.buffer = pending.buffer.slice(-20000);
  }
  const lines = pending.buffer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !!line);
  const pwdLine = [...lines].reverse().find((line) => line.startsWith('/'));
  if (!pwdLine) return;
  clearTimeout(pending.timer);
  pendingPwdCaptureMap.delete(connectionId);
  lastKnownCwdMap.set(connectionId, pwdLine);
  pending.resolve(pwdLine);
}

export async function getShellPwd(connectionId: number): Promise<string> {
  const state = sshStateMap.get(connectionId);
  if (!state?.shell) throw new Error('SSH 未连接');
  clearPendingPwdCapture(connectionId, new Error('目录采集被新的请求中断'));
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingPwdCaptureMap.delete(connectionId);
      reject(new Error('获取当前目录超时'));
    }, 6000);
    pendingPwdCaptureMap.set(connectionId, {
      buffer: '',
      timer,
      resolve,
      reject,
    });
    state.shell.write('pwd\n');
  });
}

export function processShellDataForCwdProbe(connectionId: number, chunk: string): string {
  const pending = pendingCwdProbeMap.get(connectionId);
  if (!pending) return chunk;
  pending.buffer += chunk;
  if (pending.buffer.length > 20000) {
    pending.buffer = pending.buffer.slice(-20000);
  }
  const begin = `__CODEX_CWD_BEGIN_${pending.token}__`;
  const end = `__CODEX_CWD_END_${pending.token}__`;
  const endAt = pending.buffer.lastIndexOf(end);
  const beginAt = endAt >= 0 ? pending.buffer.lastIndexOf(begin, endAt) : -1;
  if (beginAt >= 0 && endAt > beginAt) {
    const raw = pending.buffer.slice(beginAt + begin.length, endAt);
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => !!line && !line.includes(begin) && !line.includes(end));
    const pathLine =
      lines.find((line) => line.startsWith('/')) ||
      lines.find((line) => line.startsWith('~')) ||
      lines[lines.length - 1] ||
      '/';
    const cwd = pathLine.trim();
    clearTimeout(pending.timer);
    pendingCwdProbeMap.delete(connectionId);
    lastKnownCwdMap.set(connectionId, cwd || '/');
    pending.resolve(cwd || '/');
  }
  // During probe, suppress output chunks to avoid printing probe markers in terminal.
  return '';
}

export async function getInteractiveShellCwd(connectionId: number): Promise<string> {
  const state = sshStateMap.get(connectionId);
  if (!state?.shell) throw new Error('SSH 未连接');
  clearPendingCwdProbe(connectionId, new Error('目录探测被新的请求中断'));
  return new Promise<string>((resolve, reject) => {
    const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timer = setTimeout(() => {
      pendingCwdProbeMap.delete(connectionId);
      reject(new Error('获取当前目录超时'));
    }, 8000);
    pendingCwdProbeMap.set(connectionId, {
      token,
      buffer: '',
      timer,
      resolve,
      reject,
    });
    state.shell.write(`echo "__CODEX_CWD_BEGIN_${token}__"; pwd; echo "__CODEX_CWD_END_${token}__"\n`);
  });
}