import type { Plugin } from 'vite';
import fs from 'fs';
import path from 'path';

export interface ReviewIssue {
  type: 'error' | 'warning';
  rule: string;
  message: string;
  line?: number;
  suggestion?: string;
}

export interface ReviewResult {
  file: string;
  passed: boolean;
  issues: ReviewIssue[];
}

type ReviewOptions = {
  enforceComponentExportName?: boolean;
};

function parseBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim();
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isSafeRelativeTargetPath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (normalized.includes('..')) return false;
  return /^[a-zA-Z0-9/_-]+$/.test(normalized);
}

function extractDefaultExportName(content: string): string | null {
  const match = content.match(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\b/);
  return match ? match[1] : null;
}

function checkExportDefault(content: string, options: ReviewOptions): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  const hasDefaultExport = /\bexport\s+default\b/.test(content);
  if (!hasDefaultExport) {
    issues.push({
      type: 'error',
      rule: 'export-default',
      message: '缺少 export default 导出',
      suggestion: '请添加 default 导出（例如：export default App）',
    });
    return issues;
  }

  if (options.enforceComponentExportName) {
    const exportedName = extractDefaultExportName(content);
    if (exportedName !== 'Component') {
      issues.push({
        type: 'error',
        rule: 'export-default-name',
        message: exportedName
          ? `导出名称错误：使用了 "${exportedName}"，导出检查要求使用 "Component"`
          : '导出检查要求默认导出为命名变量 "Component"',
        suggestion: '请使用 `const Component = ...` 并导出 `export default Component`',
      });
    }
  }

  return issues;
}

function usesTailwindLikeClasses(content: string): boolean {
  const hasClassName = /\bclassName\s*=/.test(content);
  if (!hasClassName) return false;
  return /\b(bg-|text-|flex\b|grid\b|items-|justify-|gap-|p[trblxy]?-\d|m[trblxy]?-\d|rounded-|shadow-|border-)/.test(
    content,
  );
}

function checkTailwindCssImport(content: string, filePath: string): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  if (!usesTailwindLikeClasses(content)) return issues;

  const dir = path.dirname(filePath);
  const stylePath = path.join(dir, 'style.css');
  if (!fs.existsSync(stylePath)) {
    issues.push({
      type: 'warning',
      rule: 'tailwind-style-missing',
      message: '检测到 Tailwind 风格类名，但目录下缺少 style.css',
      suggestion: '请在同目录下添加 style.css，并确保全局已接入 Tailwind（例如 @import "tailwindcss"）',
    });
    return issues;
  }

  try {
    const style = fs.readFileSync(stylePath, 'utf8');
    const hasTailwindImport = /@import\s+["']tailwindcss["']|@tailwind\s+(base|components|utilities)/.test(style);
    if (!hasTailwindImport) {
      issues.push({
        type: 'warning',
        rule: 'tailwind-import-missing',
        message: '检测到 Tailwind 风格类名，但 style.css 未包含 Tailwind 引入',
        suggestion: '在 style.css 顶部添加：@import "tailwindcss";（或使用 @tailwind base/components/utilities）',
      });
    }
  } catch {
    issues.push({
      type: 'warning',
      rule: 'tailwind-style-read-failed',
      message: '无法读取 style.css，无法校验 Tailwind 引入',
    });
  }

  return issues;
}

function reviewFile(filePath: string, options: ReviewOptions): ReviewResult {
  if (!fs.existsSync(filePath)) {
    return {
      file: filePath,
      passed: false,
      issues: [{ type: 'error', rule: 'file-missing', message: '文件不存在' }],
    };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const issues: ReviewIssue[] = [];

  issues.push(...checkExportDefault(content, options));
  issues.push(...checkTailwindCssImport(content, filePath));

  return {
    file: filePath,
    passed: issues.every((issue) => issue.type !== 'error'),
    issues,
  };
}

export function codeReviewPlugin(): Plugin {
  return {
    name: 'code-review-plugin',
    configureServer(server) {
      const sendJson = (res: any, statusCode: number, data: any) => {
        res.statusCode = statusCode;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
      };

      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = req.url || '';
        const isCodeReviewRoute = req.method === 'POST' && url === '/api/code-review';
        if (!isCodeReviewRoute) {
          return next();
        }

        try {
          const body = await parseBody(req);
          const targetPath = String(body.path || '').trim();

          if (!targetPath) {
            sendJson(res, 400, { error: 'Missing path parameter' });
            return;
          }
          if (!isSafeRelativeTargetPath(targetPath)) {
            sendJson(res, 403, { error: 'Invalid path' });
            return;
          }

          const filePath = path.resolve(process.cwd(), 'src', targetPath, 'index.tsx');
          const enforceComponentExportName = body.enforceComponentExportName === true;
          const result = reviewFile(filePath, { enforceComponentExportName });
          sendJson(res, 200, result);
        } catch (error: any) {
          sendJson(res, 500, { error: error?.message || 'Server error' });
        }
      });
    },
  };
}
