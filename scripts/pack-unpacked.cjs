const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectDir = path.resolve(__dirname, '..');
const releaseDir = path.join(projectDir, 'release');
const optionalModule = path.join(projectDir, 'node_modules', 'cpu-features');
const optionalModuleStash = path.join(releaseDir, '.pack-stash-cpu-features');
const npmCli = process.env.npm_execpath;

const runNode = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: projectDir,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(script)} exited with code ${result.status ?? 1}`);
};

if (!npmCli) throw new Error('npm CLI path is unavailable');
runNode(npmCli, ['run', 'build']);

fs.mkdirSync(releaseDir, { recursive: true });
if (fs.existsSync(optionalModuleStash)) {
  fs.rmSync(optionalModuleStash, { recursive: true, force: true });
}

try {
  if (fs.existsSync(optionalModule)) fs.renameSync(optionalModule, optionalModuleStash);
  runNode(require.resolve('electron-builder/cli.js'), ['--dir', '--win']);
} finally {
  if (fs.existsSync(optionalModuleStash)) fs.renameSync(optionalModuleStash, optionalModule);
}

const sourceDir = path.join(releaseDir, 'win-unpacked');
const targetDir = path.join(releaseDir, 'Termio');
if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
if (fs.existsSync(sourceDir)) fs.renameSync(sourceDir, targetDir);
