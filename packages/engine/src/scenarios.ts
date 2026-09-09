import type { RunOptions } from './run.js';

/**
 * DESIGN.md 7 の MVP シナリオのうち M1 で扱う2本 (+ 索引を外した対比)。
 * UI のシナリオプリセット (DESIGN.md 5) と plan-consistency テストの両方がここを読む。
 *
 * `mysqlSql` は同じアクセスパスを実 MySQL に取らせるための等価な SQL。
 * 「索引を外す」対比はサポート範囲 (DESIGN.md 9) に `IGNORE INDEX` を持ち込まず、
 * エンジン側は `ignoreIndexes` オプション、MySQL 側は `IGNORE INDEX` ヒントで表現する
 * (この対応は FIDELITY.md に記載)。
 */
export interface Scenario {
  readonly name: string;
  /** tools/mysql/fixtures のファイル名 (拡張子なし)。 */
  readonly fixture: string;
  readonly sql: string;
  readonly mysqlSql: string;
  readonly options: RunOptions;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: 'シナリオ1: UNIQUE セカンダリ索引の等値検索',
    fixture: 's1-users-email-eq',
    sql: "SELECT * FROM users WHERE email = 'hina.watanabe100@example.com'",
    mysqlSql: "SELECT * FROM users WHERE email = 'hina.watanabe100@example.com'",
    options: {},
  },
  {
    name: 'シナリオ1(対比): 索引を外したフルスキャン',
    fixture: 's1-users-email-eq-noindex',
    sql: "SELECT * FROM users WHERE email = 'hina.watanabe100@example.com'",
    mysqlSql:
      "SELECT * FROM users IGNORE INDEX (idx_users_email) WHERE email = 'hina.watanabe100@example.com'",
    options: { ignoreIndexes: ['idx_users_email'] },
  },
  {
    name: 'シナリオ2: カバリング索引の範囲検索',
    fixture: 's2-orders-user-range',
    sql: 'SELECT user_id, status FROM orders WHERE user_id BETWEEN 10 AND 20',
    mysqlSql: 'SELECT user_id, status FROM orders WHERE user_id BETWEEN 10 AND 20',
    options: {},
  },
];

export function scenarioByFixture(fixture: string): Scenario {
  const s = SCENARIOS.find((x) => x.fixture === fixture);
  if (!s) throw new Error(`シナリオ ${fixture} がありません`);
  return s;
}
