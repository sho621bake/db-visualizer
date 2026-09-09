# DB Visualizer 設計書

MySQL (InnoDB) のクエリ実行を、SQLエディタから入力したクエリに対して3Dアニメーションで再生し、任意の位置で停止・ホバー解説ができる学習サイト。

## 1. 目的と非目的

**目的**
- `SELECT` / `JOIN` / `WHERE` / `ORDER BY` を書ける人が、「オプティマイザが何を選び、エグゼキュータがどのページ・どのB+Treeノードをどの順で触るか」を体感で理解できる
- インデックスの有無・種類(セカンダリ / カバリング)で I/O 回数がどう変わるかを「見て」比較できる

**非目的 (MVPでは扱わない)**
- トランザクション / MVCC / ロック / redo・undo ログ
- DML (`INSERT/UPDATE/DELETE`)、DDL
- MySQL の完全なSQL方言・完全なコストモデルの再現
- マルチユーザー / 永続化 / 認証

## 2. 設計判断 (結論)

| 論点 | 決定 | 理由 |
|---|---|---|
| 実行の可視化方法 | **自前の教育用擬似エンジン**がステップイベント列(Trace)を生成し、3D側はそれを再生するだけ | 実DBは内部の途中状態を外に出さない。停止・巻き戻し・速度変更を作るには決定論的なイベント列が手元に必要 |
| 正しさの担保 | 同一シードデータを入れた **実MySQL 8.4 (Docker)** で `EXPLAIN FORMAT=JSON` と結果集合を突き合わせるテストを CI に置く | 「教材が嘘をつかない」ことをプロンプトではなくテストで固定する |
| 忠実度の扱い | 再現している点・意図的に簡略化した点を `docs/FIDELITY.md` に台帳化し、UIにも表示 | 簡略化は避けられない。隠さず明示する方が学習効果が高い |
| リポジトリ構成 | pnpm workspace: `packages/engine` (純TS, DOM非依存) + `apps/web` (React) | エンジンを Node 単体でテストでき、3D実装と独立に進められる |
| SQLパーサ | `node-sql-parser` (dialect: mysql) でASTを得て、以降(プランナ・実行)は自前 | パーサ自作は学習価値が低くコストが高い。MySQL方言のAST化はライブラリに任せる |
| 3D | `@react-three/fiber` + `@react-three/drei` | React state からシーンを宣言的に組めるため、Trace再生位置 → 描画の写像が単純になる |
| SQLエディタ | CodeMirror 6 (`@codemirror/lang-sql`, MySQL dialect) | Monaco はバンドルが重く Vite との相性調整が必要。学習サイトの要件では CodeMirror で十分 |
| 状態管理 | zustand | プレイヤー状態(現在index・速度・再生中)が全コンポーネントから参照されるため。Redux ほどの儀式は不要 |
| lint/format | Biome | 1ツールで lint+format、設定が少なく hooks から高速に呼べる |
| テスト | Vitest (unit / plan-consistency) + Playwright (e2e) | |

## 3. アーキテクチャ

```
apps/web (React + R3F)
  ├── editor/      SQLエディタ (CodeMirror)
  ├── player/      再生制御 (play/pause/step/scrub/speed)  [zustand store]
  ├── scene/       3Dシーン (Trace の現在位置を描画に写像)
  ├── panels/      EXPLAIN パネル / オプティマイザ候補比較 / 用語解説(hover)
  └── glossary/    イベント種別 → 解説文 (ja)
        ▲ Trace (JSON, 決定論的)
packages/engine (純TS)
  ├── catalog/     テーブル定義・シードデータ・統計(cardinality)
  ├── storage/     ページ(16KB相当)・クラスタ索引/セカンダリ索引の B+Tree・バッファプール
  ├── parser/      node-sql-parser → 内部AST (サポート範囲外は明示エラー)
  ├── planner/     候補アクセスパス列挙 + 簡易コスト → PlanTree (MySQL EXPLAIN 互換の語彙)
  ├── executor/    Volcano/iterator モデル。実行しながら StepEvent を emit
  └── trace/       StepEvent スキーマ(zod)・シリアライズ
tools/
  └── mysql/       docker-compose (mysql:8.4) + 同一シードの DDL/DML + plan-consistency テスト
```

データフロー: `SQL文字列 → parse → plan → execute → Trace[] → Player(現在index) → Scene描画`

Trace は実行前に**全件生成**する(ストリーミングしない)。理由: スクラブ(任意位置へジャンプ)を O(1) にするため。データ量は §6 のサイズなら数千イベントで収まる。

## 4. ドメインモデル (InnoDB の再現範囲)

### 4.1 ストレージ
- **テーブルスペース → ページ**: 1ページ = 実機16KB。教育用に **1ページ = 8行** に縮小(FIDELITY.md に明記)
- **クラスタ索引 (PK B+Tree)**: リーフに行本体。InnoDB の「テーブル = PKのB+Tree」を必ず見せる
- **セカンダリ索引 B+Tree**: リーフには `(索引キー, PK値)` のみ。行本体を取るには **クラスタ索引へ再検索** (この "戻り" が I/O 増の主因であることを可視化の中心に置く)
- **カバリング索引**: 必要列が全てセカンダリ索引に含まれる場合、クラスタ索引に戻らない (`Extra: Using index`)
- **バッファプール**: LRU の簡略版。ページが既にメモリにあれば disk I/O を発生させない。ヒット/ミスを色で区別

### 4.2 オプティマイザ (簡易コストベース)
- 各テーブルについて候補アクセスパスを列挙: `ALL` / `const` / `eq_ref` / `ref` / `range` / `index`
- コスト = 推定 I/O ページ数 + 推定評価行数 × 定数 (MySQL の cost model の思想を踏襲、数値は独自)
- 推定行数は catalog の統計 (テーブル行数, インデックスの cardinality) から算出
- JOIN: 駆動表は「フィルタ後推定行数が小さい方」。内部表に使える索引があれば **Nested Loop Join**、無ければ **Hash Join** (MySQL 8.0.18+ の挙動。Block Nested Loop は 8.0.20 で廃止済みのため扱わない)
- ORDER BY: 索引順で取れるなら索引利用、無理なら `filesort`
- **候補比較パネル**: 採用案だけでなく不採用案のコストも表示 (「なぜこの索引が選ばれたか」を答えるため)

### 4.3 エグゼキュータ
- iterator モデル (`open/next/close`)。MySQL 8.0 の `EXPLAIN FORMAT=TREE` と対応する構造にする
- ノード: `TableScan`, `IndexRangeScan`, `IndexLookup(ref)`, `ClusteredLookup`, `Filter`, `NestedLoopJoin`, `HashJoin`, `Sort(filesort)`, `Limit`, `Projection`

### 4.4 StepEvent (Trace) スキーマ
すべてのイベントは `{ seq: number, type: string, nodeId: string, ...payload }`。`nodeId` は PlanTree のノードを指す。

主なイベント種別:

| type | payload | 3D表現 |
|---|---|---|
| `plan.selected` | planTree, candidates[] | EXPLAINパネル更新 |
| `page.read` | table, index, pageId, source: `bufferpool`/`disk` | ページタイルが点灯。diskなら下段から上段へ移動 |
| `btree.descend` | index, level, nodeId, searchKey | ツリーのノードを上から順にハイライト |
| `btree.leaf.scan` | index, pageId, fromKey, toKey | リーフを横方向にスキャン |
| `row.read` | table, pk | 行がページから浮き上がる |
| `clustered.lookup` | table, pk, from: secondaryIndexName | セカンダリ → クラスタへ矢印 |
| `filter.eval` | nodeId, pk, passed: boolean | 通過/棄却で色分け |
| `join.probe` | side, key, matched: boolean | 駆動表の行が内部表へ飛ぶ |
| `hash.build` / `hash.probe` | key, bucket | ハッシュ表のバケットに行が入る/引かれる |
| `sort.buffer` / `sort.emit` | rows | ソートバッファに積まれ整列して出る |
| `row.emit` | nodeId, row | 結果グリッドに行が到着 |
| `stats` | pagesRead, diskReads, rowsExamined, rowsReturned | フッタの計数 |

各 `type` は `apps/web/glossary/ja.ts` に解説文を持つ。**解説文の欠落は型エラーになる**(`Record<StepEvent['type'], Glossary>` で網羅を強制)。

## 5. UI 仕様

レイアウト (デスクトップ優先):
- 左: SQLエディタ + 「実行」+ シナリオプリセット (3本)
- 中央: 3Dシーン。下段=ディスク(ページタイル群)、中段=バッファプール、上段=B+Tree と実行ノードのパイプライン、右上=結果グリッド
- 右: EXPLAIN パネル (MySQL の `EXPLAIN` 表形式 + `FORMAT=TREE` 風) / 候補比較 / 現在イベントの解説
- 下: プレイヤーバー (再生/停止/1ステップ/スクラブ/速度 0.25x〜4x)

操作:
- ホバー: ページ・ノード・行・実行ノードに対して用語解説ツールチップ
- クリック(実行ノード): そのノードが発生させたイベントだけをフィルタ表示
- キーボード: Space=再生/停止, ←/→=1ステップ

デザイン方針: 説明が主役なので装飾は最小。色は「ディスクI/O=赤系, バッファプールヒット=緑系, 棄却=灰」の3系統に固定し、凡例を常時表示。

## 6. シードデータ

| テーブル | 行数 | 主キー | セカンダリ索引 |
|---|---|---|---|
| `users` | 200 | `id` | `idx_users_email(email)` UNIQUE, `idx_users_country(country)` |
| `orders` | 2,000 | `id` | `idx_orders_user(user_id)`, `idx_orders_user_status(user_id, status)` |
| `products` | 50 | `id` | なし |

行数は「1ページ8行」で B+Tree が 3 レベルになる程度に調整する(2レベル以下だと descend が見えない)。生成は固定シード(乱数 seed 固定)で、エンジンと MySQL コンテナで**同一のDDL/DMLファイル**を共有する。

## 7. MVP シナリオ (3本)

1. **フルスキャン vs セカンダリ索引** — `SELECT * FROM users WHERE email = ?` を索引あり/なしで比較。`ALL` と `ref` の違い、`clustered.lookup` の発生を見せる
2. **カバリング索引と範囲検索** — `SELECT user_id, status FROM orders WHERE user_id BETWEEN ? AND ?`。`range` + `Using index` でクラスタへ戻らないことを見せる
3. **JOIN** — `SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = u.id WHERE u.country = 'JP'`。駆動表の選択と Nested Loop Join。索引を外すと Hash Join に切り替わる対比も行う

## 8. 検証 (plan-consistency テスト)

`tools/mysql/` に `docker-compose.yml` (mysql:8.4) と `seed.sql` を置き、テストは:
1. エンジンで `plan(sql)` → 各テーブルの `access_type` / `key` / 駆動表順を取得
2. MySQL で `EXPLAIN FORMAT=JSON` を実行し、同じ項目を抽出
3. 一致を assert。結果集合も `SELECT` 結果と行単位で一致を assert
4. 不一致は **エンジン側のバグ**として扱う(MySQL が正)。ただし FIDELITY.md に「意図的差分」として登録済みの項目は除外リストで許容

Docker が無い環境では `PLAN_TEST=skip` で明示的にスキップし、CI では必ず実行する。

## 9. サポートするSQLサブセット

- `SELECT <列リスト | *> FROM <table> [AS alias]`
- `[INNER] JOIN <table> ON <col> = <col>` (1つまで)
- `WHERE` : `=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, `AND` (OR, IN, LIKE は MVP 外)
- `ORDER BY <col> [ASC|DESC]` (1列)
- `LIMIT n`

範囲外はパース後に **「未対応: ○○」をUIに表示**し、黙って近似しない。

## 10. 未決事項

- コスト定数の具体値 (M1 で MySQL の選択と一致するまで調整する。一致が取れない場合は候補比較パネルに「MySQL実測との差」を表示する案を検討)
- 3D のパフォーマンス目標 (2,000行×イベント数千で 60fps を維持できるかは M2 で計測)
- モバイル対応の要否 (MVPでは非対応とし、警告表示のみ)
