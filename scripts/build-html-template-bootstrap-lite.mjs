import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = path.resolve(__dirname, '..');
const entry = path.join(workspaceRoot, 'admin', 'assets', 'html-template-bootstrap-lite.ts');
const outDir = path.join(workspaceRoot, 'dist', 'assets');
const outFile = path.join(outDir, 'html-template-bootstrap-lite.js');

if (!fs.existsSync(entry)) {
  process.stderr.write(`Missing bootstrap entry: ${entry}\n`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

await build({
  configFile: false,
  root: workspaceRoot,
  logLevel: 'info',
  build: {
    lib: {
      entry,
      name: 'HtmlTemplateBootstrapLite',
      formats: ['iife'],
      fileName: () => 'html-template-bootstrap-lite.js',
    },
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2018',
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});

if (!fs.existsSync(outFile)) {
  process.stderr.write(`Bootstrap build did not produce output: ${outFile}\n`);
  process.exit(1);
}
