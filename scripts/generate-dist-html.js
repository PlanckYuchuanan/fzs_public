#!/usr/bin/env node

/**
 * 为 dist 目录下的所有 JS 文件生成对应的 HTML 文件
 * 使用 html-template.html 模板，用于构建后直接访问
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const workspaceRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(workspaceRoot, 'dist');
const adminDir = path.resolve(workspaceRoot, 'admin');
const templatePath = path.join(adminDir, 'html-template.html');

let generatedCount = 0;

// 检查模板是否存在
if (!fs.existsSync(templatePath)) {
  console.error('错误: html-template.html 模板不存在，请先构建 prototype-admin');
  console.error('路径:', templatePath);
  process.exit(1);
}

// 检查 dist 目录是否存在
if (!fs.existsSync(distDir)) {
  console.log('dist 目录不存在，跳过 HTML 生成');
  process.exit(0);
}

const template = fs.readFileSync(templatePath, 'utf8');

/**
 * 递归遍历目录，为每个 JS 文件生成 HTML
 */
function generateHtmlForDirectory(dir, baseDir = distDir) {
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      // 递归处理子目录
      generateHtmlForDirectory(itemPath, baseDir);
    } else if (item.name.endsWith('.js') && !item.name.includes('.worker')) {
      // 为 JS 文件生成 HTML
      const relativePath = path.relative(baseDir, itemPath);
      const normalizedRelativePath = relativePath.split(path.sep).join('/');
      const jsName = normalizedRelativePath.replace('.js', '');
      if (jsName.startsWith('assets/')) continue;
      const htmlPath = path.join(dir, item.name.replace('.js', '.html'));

      // 根据路径生成标题
      let title = 'Preview';
      if (jsName.startsWith('components/')) {
        const name = jsName.replace('components/', '');
        title = `Element: ${name}`;
      } else if (jsName.startsWith('prototypes/')) {
        const name = jsName.replace('prototypes/', '');
        title = `Page: ${name}`;
      }

      // 计算 JS 文件的相对路径（从 HTML 的位置）
      const jsFileName = `./${item.name}`;
      
      // 计算 bootstrap JS 的相对路径
      const relativeDir = path.relative(baseDir, dir);
      const depth = relativeDir ? relativeDir.split(path.sep).length : 0;
      const bootstrapPath = depth > 0 
        ? '../'.repeat(depth) + 'assets/html-template-bootstrap-lite.js'
        : './assets/html-template-bootstrap-lite.js';

      // 替换模板变量
      let html = template.replace('{{TITLE}}', title);
      html = html.replace('{{ENTRY}}', jsFileName);
      html = html.replace('{{BOOTSTRAP_PATH}}', bootstrapPath);

      // 写入 HTML 文件
      fs.writeFileSync(htmlPath, html, 'utf8');
      console.log(`生成: ${relativePath.replace('.js', '.html')}`);
      generatedCount++;
    }
  }
}

console.log('\n开始为 dist 目录生成 HTML 文件...\n');

generateHtmlForDirectory(distDir);

console.log(`\n完成！共生成 ${generatedCount} 个 HTML 文件。`);
console.log('模板文件: admin/html-template.html\n');
const liteBootstrap = path.join(distDir, 'assets', 'html-template-bootstrap-lite.js');
if (fs.existsSync(liteBootstrap)) {
  console.log('✓ html-template-bootstrap-lite.js 已存在于 dist/assets');
} else {
  console.warn('⚠ html-template-bootstrap-lite.js 不存在，请先运行 node scripts/build-html-template-bootstrap-lite.mjs');
}

