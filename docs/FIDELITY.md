# 忠実度台帳 (FIDELITY.md)

このファイルは「実際の MySQL/InnoDB とどこが同じで、どこを意図的に変えたか」の台帳。
エンジンやシーンを変更する PR は、影響する行をここで更新すること。`fidelity-reviewer` サブエージェントはこの表を基準にレビューする。

凡例: ✅ 実物と同じ挙動 / ⚠️ 簡略化 (意図的) / ❌ 未実装

## ストレージ

| 項目 | 状態 | 備考 |
|---|---|---|
| テーブル本体がPKのB+Tree (クラスタ索引) | ✅ | |
| セカンダリ索引のリーフがPK値を持ち、行取得にクラスタ索引を再検索する | ✅ | 可視化の中心 |
| カバリング索引でクラスタ索引に戻らない | ✅ | `Extra: Using index` |
| ページサイズ | ⚠️ | 実機16KB → 教育用に **1ページ8エントリ** 固定 (`LEAF_ENTRIES = 8`) |
| 内部ノードのファンアウト | ⚠️ | **16** 固定 (`INTERNAL_FANOUT = 16`)。この値で users(200行)・orders(2,000行) が3レベル、products(50行) が2レベルになり、descend が見える |
| B+Tree の構築方法 | ⚠️ | ソート済みエントリからのバルクロードのみ。MVP は SELECT だけなので挿入・ページ分割・マージは未実装 |
| バッファプール | ⚠️ | 単純LRU、サイズは総ページ数の 25% 固定。実機の young/old サブリスト、プリフェッチは未実装 |
| Change Buffer / Adaptive Hash Index | ❌ | 学習範囲外 |
| ページ内の行フォーマット (Compact/Dynamic)、ページディレクトリ | ❌ | ページ内は「行のリスト」として描く |

## オプティマイザ

| 項目 | 状態 | 備考 |
|---|---|---|
| アクセスタイプの語彙 (`ALL/index/range/ref/eq_ref/const`) | ✅ | EXPLAIN と同じ語で表示 |
| 行数推定 | ⚠️ | `const` / `ref` / `range` は MySQL の range optimizer と同じく **index dive で実数を数える** (既定の `eq_range_index_dive_limit=200` の範囲では MySQL も実数を返すため)。ヒストグラムと `filtered` の推定は未対応 |
| コスト定数 | ⚠️ | `IO_COST = 1.0` / `ROW_EVAL_COST = 0.1` (MySQL の read_cost : eval_cost の比を踏襲)。cost = 推定ページ数 × IO_COST + 推定行数 × ROW_EVAL_COST。実 MySQL の EXPLAIN を先に採取し、シナリオ1が `const`、シナリオ2が `idx_orders_user_status` になるよう決めた。**選択結果の一致**のみ plan-consistency テストで担保し、絶対値の一致は求めない |
| `EXPLAIN` の `Extra` | ⚠️ | `Using where` (Filter ノードがあるとき) と `Using index` (セカンダリ索引でカバリングのとき) の2つだけ生成する。`key_len` / `ref` / `filtered` / `cost_info` は未出力 |
| 索引を無効化する指定 | ⚠️ | サポート範囲 (DESIGN.md 9) に `IGNORE INDEX` 構文を持ち込まないため、エンジンは `plan(sql, { ignoreIndexes: [...] })` オプションで表現する。plan-consistency テストでは MySQL 側の `IGNORE INDEX (...)` ヒントと対応付ける (`Scenario.mysqlSql`) |
| JOIN順序 | ⚠️ | 2表のみ。貪欲(推定行数の小さい方を駆動表) |
| Nested Loop Join / Hash Join の切替 | ✅ | 内部表に使える索引の有無で決定 (8.0.18+ の挙動) |
| Block Nested Loop | ❌ | 8.0.20 で廃止のため扱わない |
| Index Condition Pushdown, MRR, Batched Key Access | ❌ | |
| サブクエリ、派生表、CTE | ❌ | |

## エグゼキュータ

| 項目 | 状態 | 備考 |
|---|---|---|
| iterator (Volcano) モデル | ✅ | `EXPLAIN FORMAT=TREE` の構造に対応 |
| filesort | ❌ | M1 時点では未実装。索引順で満たせない `ORDER BY` は「未対応: 索引順で満たせない ORDER BY (filesort は M3 で対応予定)」を返す (黙って近似しない) |
| LIMIT の早期終了 | ✅ | |

## シードデータ

| 項目 | 状態 | 備考 |
|---|---|---|
| エンジンと MySQL が同一シードを見る | ✅ | `tools/mysql/generate-seed.mjs` (固定シードの mulberry32) が `tools/mysql/seed.sql` と `packages/engine/src/catalog/seed-data.generated.ts` の**両方**を出力する。エンジンをブラウザで動かすため実行時のファイル読み込みは避け、生成物を両方コミットして `tools/mysql/test/seed-regeneration.test.ts` でバイト一致を担保する |

## plan-consistency テストの許容差分リスト

MySQL と意図的に一致させない項目。テストではここに列挙した項目を除外する
(`tools/mysql/test/plan-consistency.test.ts` の `ALLOWED_DIFFS` と同期させること)。
書式は `<fixture 名>:<比較項目名>`。

- (現時点なし。M1 のシナリオ1・2はいずれも `access_type` / `key` / `possible_keys` / `rows` と結果集合が実 MySQL 8.4 と一致している)
