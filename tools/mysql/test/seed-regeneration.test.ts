import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error 生成器は .mjs で型定義を持たない (生成ロジックの単一の真実)
import { GENERATED } from '../generate-seed.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

const generated = GENERATED as {
  seedSql: string;
  seedTs: string;
  counts: { users: number; products: number; orders: number };
};

describe('シード生成物の同期', () => {
  it('生成器の再実行結果が tools/mysql/seed.sql とバイト一致する', () => {
    const onDisk = readFileSync(join(ROOT, 'tools', 'mysql', 'seed.sql'), 'utf8');
    expect(generated.seedSql).toBe(onDisk);
  });

  it('生成器の再実行結果が seed-data.generated.ts とバイト一致する', () => {
    const onDisk = readFileSync(
      join(ROOT, 'packages', 'engine', 'src', 'catalog', 'seed-data.generated.ts'),
      'utf8',
    );
    expect(generated.seedTs).toBe(onDisk);
  });

  it('行数が DESIGN.md §6 のとおりである', () => {
    expect(generated.counts).toEqual({ users: 200, products: 50, orders: 2000 });
  });
});
