import { describe, expect, it } from 'vitest';
import { UnsupportedSqlError } from '../src/parser/ast.js';
import { parse } from '../src/parser/parse.js';

describe('パーサ: サポート範囲', () => {
  it('SELECT * と WHERE の等値を AST にする', () => {
    expect(parse("SELECT * FROM users WHERE email = 'a@example.com'")).toEqual({
      columns: 'all',
      from: { table: 'users' },
      where: { kind: 'compare', op: '=', column: { column: 'email' }, value: 'a@example.com' },
    });
  });

  it('列リスト・BETWEEN を AST にする', () => {
    expect(parse('SELECT user_id, status FROM orders WHERE user_id BETWEEN 10 AND 20')).toEqual({
      columns: [{ column: 'user_id' }, { column: 'status' }],
      from: { table: 'orders' },
      where: { kind: 'between', column: { column: 'user_id' }, low: 10, high: 20 },
    });
  });

  it('エイリアス・AND・ORDER BY・LIMIT を AST にする', () => {
    expect(
      parse(
        "SELECT u.id FROM users AS u WHERE u.country = 'JP' AND u.id > 5 ORDER BY u.id LIMIT 3",
      ),
    ).toEqual({
      columns: [{ qualifier: 'u', column: 'id' }],
      from: { table: 'users', alias: 'u' },
      where: {
        kind: 'and',
        left: {
          kind: 'compare',
          op: '=',
          column: { qualifier: 'u', column: 'country' },
          value: 'JP',
        },
        right: { kind: 'compare', op: '>', column: { qualifier: 'u', column: 'id' }, value: 5 },
      },
      orderBy: { column: { qualifier: 'u', column: 'id' }, direction: 'ASC' },
      limit: 3,
    });
  });
});

describe('パーサ: サポート範囲外は日本語で明示する', () => {
  const cases: readonly [string, string][] = [
    ['SELECT * FROM users WHERE id = 1 OR id = 2', '未対応: OR 条件'],
    ['SELECT * FROM users WHERE id IN (1, 2)', '未対応: IN 条件'],
    ["SELECT * FROM users WHERE email LIKE 'a%'", '未対応: LIKE 条件'],
    ['SELECT * FROM users WHERE id <> 1', '未対応: 不等号 (<>) 条件'],
    ['SELECT COUNT(*) FROM users', '未対応: 関数・式を含む選択列'],
    ['SELECT id AS pk FROM users', '未対応: 列のエイリアス (AS)'],
    ['SELECT * FROM users u JOIN orders o ON o.user_id = u.id', '未対応: JOIN (M3 で対応予定)'],
    ['SELECT id FROM users GROUP BY id', '未対応: GROUP BY'],
    ['SELECT DISTINCT id FROM users', '未対応: DISTINCT'],
    ['SELECT id FROM users ORDER BY id, email', '未対応: 複数列の ORDER BY'],
    ['SELECT id FROM users LIMIT 10, 5', '未対応: OFFSET 付き LIMIT'],
    ["UPDATE users SET name = 'x' WHERE id = 1", '未対応: SELECT 以外の文'],
  ];

  for (const [sql, message] of cases) {
    it(`${sql} は「${message}」を返す`, () => {
      expect(() => parse(sql)).toThrowError(UnsupportedSqlError);
      expect(() => parse(sql)).toThrowError(message);
    });
  }

  it('そもそも SQL として壊れている場合も UnsupportedSqlError になる', () => {
    expect(() => parse('SELEC * FRM users')).toThrowError(UnsupportedSqlError);
  });
});
