import { spawn } from 'node:child_process';

import { getPreferredNpmCommand, getSpawnCommandSpec } from './utils/command-runtime.mjs';

const npmCommand = getPreferredNpmCommand();
const children = [];
let shuttingDown = false;

function prefixOutput(stream, label, color) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line) continue;
      process.stdout.write(`${color}[${label}]\x1b[0m ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buffer) {
      process.stdout.write(`${color}[${label}]\x1b[0m ${buffer}\n`);
      buffer = '';
    }
  });
}

function spawnScript(label, scriptName, color) {
  const spec = getSpawnCommandSpec(npmCommand, ['run', scriptName]);
  const child = spawn(spec.command, spec.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: spec.windowsHide,
  });

  children.push(child);

  if (child.stdout) prefixOutput(child.stdout, label, color);
  if (child.stderr) prefixOutput(child.stderr, label, color);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const exitCode = typeof code === 'number' ? code : 0;
    const reason = signal ? `signal ${signal}` : `code ${exitCode}`;
    process.stderr.write(`[${label}] exited with ${reason}\n`);
    shutdown(exitCode);
  });

  child.on('error', (error) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`[${label}] failed to start: ${error.message}\n`);
    shutdown(1);
  });
}

function killProcessTree(child) {
  if (!child || child.killed) return;

  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.on('close', () => {});
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {}
}

function shutdown(exitCode = 0) {
  if (!shuttingDown) shuttingDown = true;
  for (const child of children) {
    killProcessTree(child);
  }
  setTimeout(() => {
    process.exit(exitCode);
  }, 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

process.stdout.write('Starting frontend and backend...\n');
spawnScript('api', 'dev:api', '\x1b[35m');
spawnScript('web', 'dev', '\x1b[36m');

