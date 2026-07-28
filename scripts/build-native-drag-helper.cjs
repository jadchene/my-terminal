const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (process.platform !== 'win32') {
  console.log('Skipping the Windows virtual-file drag helper on this platform.');
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const windowsDir = process.env.WINDIR || 'C:\\Windows';
const compilerCandidates = [
  path.join(windowsDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(windowsDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
];
const compiler = compilerCandidates.find((candidate) => fs.existsSync(candidate));
if (!compiler) {
  throw new Error(`.NET Framework C# compiler not found. Tried: ${compilerCandidates.join(', ')}`);
}

const source = path.join(root, 'native', 'windows-virtual-file-drag', 'VirtualFileDrag.cs');
const outputDir = path.join(root, 'dist-electron', 'native');
const output = path.join(outputDir, 'my-terminal-virtual-file-drag.exe');
fs.mkdirSync(outputDir, { recursive: true });

const result = spawnSync(
  compiler,
  [
    '/nologo',
    '/target:exe',
    '/platform:anycpu',
    '/optimize+',
    `/out:${output}`,
    '/reference:System.dll',
    '/reference:System.Core.dll',
    '/reference:System.Web.Extensions.dll',
    source,
  ],
  { cwd: root, encoding: 'utf8', windowsHide: true },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status || 1);
console.log(`Built ${path.relative(root, output)}`);
