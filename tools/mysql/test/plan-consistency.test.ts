import { run, SCENARIOS } from '@db-visualizer/engine';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * DESIGN.md 8 の検証。エンジンのプランと実 MySQL 8.4 の EXPLAIN / 結果集合を突き合わせる。
 * 不一致は **エンジン側のバグ** として扱う (MySQL が正)。
 * FIDELITY.md の「許容差分リスト」に登録済みの項目だけを ALLOWED_DIFFS で除外する。
 *
 * Docker が無い環境では `PLAN_TEST=skip` でスキップする。CI では必ず実行する。
 */

const SKIP = process.env.PLAN_TEST === 'skip';

/** FIDELITY.md の許容差分リストと同期させること。 */
const ALLOWED_DIFFS: readonly string[] = [];

interface ExplainJson {
  query_block: {
    table?: {
      table_name: string;
      access_type: string;
      possible_keys?: string[] | null;
      key?: string;
      rows_examined_per_scan?: number;
      using_index?: boolean;
      attached_condition?: string;
    };
  };
}

let conn: mysql.Connection;

beforeAll(async () => {
  if (SKIP) return;
  conn = await mysql.createConnection({
    host: '127.0.0.1',
    port: 13306,
    user: 'root',
    password: 'root',
    database: 'innodb_viz',
    // 数値/文字列の型を JS 側で揃えるため
    decimalNumbers: true,
  });
});

afterAll(async () => {
  if (conn) await conn.end();
});

async function explainJson(sql: string): Promise<ExplainJson> {
  const [rows] = await conn.query(`EXPLAIN FORMAT=JSON ${sql}`);
  const first = (rows as Record<string, string>[])[0];
  if (!first) throw new Error('EXPLAIN が空を返しました');
  const raw = Object.values(first)[0];
  if (typeof raw !== 'string') throw new Error('EXPLAIN の JSON を取得できませんでした');
  return JSON.parse(raw) as ExplainJson;
}

/** MySQL の EXPLAIN JSON から、エンジンと比較する項目だけを取り出す。 */
function mysqlShape(json: ExplainJson) {
  const t = json.query_block.table;
  if (!t) throw new Error('EXPLAIN に table がありません');
  return {
    table: t.table_name,
    access_type: t.access_type,
    possible_keys: t.possible_keys ?? null,
    key: t.key ?? null,
    rows: t.rows_examined_per_scan ?? null,
  };
}

const describeOrSkip = SKIP ? describe.skip : describe;

describeOrSkip('plan-consistency: エンジンのプランが実 MySQL と一致する', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.name}: access_type / key / possible_keys / rows が一致する`, async () => {
      const engine = run(scenario.sql, scenario.options).explain;
      const actual = mysqlShape(await explainJson(scenario.mysqlSql));

      const diffKeys = ALLOWED_DIFFS.filter((d) => d.startsWith(`${scenario.fixture}:`)).map(
        (d) => d.split(':')[1],
      );
      const omit = <T extends object>(o: T) =>
        Object.fromEntries(Object.entries(o).filter(([k]) => !diffKeys.includes(k)));

      expect(
        omit({
          table: engine.table,
          access_type: engine.access_type,
          possible_keys: engine.possible_keys ? [...engine.possible_keys] : null,
          key: engine.key,
          rows: engine.rows,
        }),
      ).toEqual(omit(actual));
    });

    it(`${scenario.name}: 結果集合が行単位で一致する`, async () => {
      const engine = run(scenario.sql, scenario.options).rows;
      const [rows] = await conn.query(scenario.mysqlSql);
      const actual = (rows as Record<string, unknown>[]).map(normalizeRow);
      expect(engine.map(normalizeRow)).toEqual(actual);
    });
  }
});

/** DATETIME は mysql2 が Date で返すのでシードと同じ文字列に戻す。 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v instanceof Date ? formatDateTime(v) : v;
  }
  return out;
}

function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
