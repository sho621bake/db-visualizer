import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 不変条件2: packages/engine は apps/web / three / react に依存しない。
// hooks (guard-edit.sh) に加えてテストでも静的に固定する。
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const FORBIDDEN = [
  /from\s+['"]react['"]/,
  /from\s+['"]react-dom/,
  /from\s+['"]three['"]/,
  /from\s+['"]@react-three\//,
  /from\s+['"][^'"]*apps\/web/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('エンジンの UI 非依存', () => {
  it('src 配下に react / three / apps/web への import が無い', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${file}: ${pattern}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
