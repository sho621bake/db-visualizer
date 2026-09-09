# 実装計画 (PLAN.md)

## 完了条件 (推奨案・暫定)

MVP の完了 = 以下がすべて緑:

```
pnpm check      # biome check + tsc --noEmit + vitest run (unit + plan-consistency)
pnpm e2e        # playwright: docs/DESIGN.md §7 の3シナリオを再生し、停止・スクラブ・ホバー解説を検証
```

- `pnpm check` は **Docker 上の MySQL 8.4 を起動した状態**で実行する (plan-consistency テストが含まれるため)。ローカルで Docker が無い場合のみ `PLAN_TEST=skip pnpm check` を許容し、CI では常に実行
- 各マイルストーンにも個別の完了条件を置き、Claude Code には**1マイルストーンずつ**依頼する (手戻り範囲を1マイルストーンに閉じるため)

## マイルストーン

### M0: 足場 (半日)
- pnpm workspace (`packages/engine`, `apps/web`, `tools/mysql`)
- Biome / TypeScript strict / Vitest / Playwright / `.claude/` の hooks とサブエージェント
- `tools/mysql/docker-compose.yml` + `seed.sql` (DESIGN.md §6)
- **完了**: 空実装で `pnpm check` と `pnpm e2e` が通る。`docker compose up` 後に `mysql` に seed が入る

### M1: エンジン (シナリオ1・2)
- catalog / storage (ページ・クラスタ索引・セカンダリ索引の B+Tree・バッファプール)
- parser (サブセット) / planner (`ALL`, `ref`, `range`, `const`, カバリング判定) / executor (`TableScan`, `IndexRangeScan`, `IndexLookup`, `ClusteredLookup`, `Filter`, `Projection`, `Limit`)
- trace スキーマ (zod) と JSON 出力
- **完了**: シナリオ1・2について plan-consistency テストが通る (access_type / key / 結果集合が MySQL と一致)。Trace のスナップショットテストあり

### M2: プレイヤー + 3Dシーン (シナリオ1・2)
- zustand store (Trace, currentIndex, playing, speed)
- シーン: ディスク層・バッファプール層・B+Tree・実行パイプライン・結果グリッド
- プレイヤーバー、ホバー解説 (glossary 網羅を型で強制)
- SQLエディタ (CodeMirror) とプリセット
- **完了**: e2e でシナリオ1・2を再生し、(a) 任意位置で停止できる (b) スクラブで描画が追従する (c) `clustered.lookup` イベントにホバーで解説が出る

### M3: JOIN + オプティマイザ可視化 (シナリオ3)
- planner: 駆動表選択、NLJ / Hash Join
- executor: `NestedLoopJoin`, `HashJoin`, `Sort(filesort)`
- EXPLAIN パネル (表形式 + TREE風)、候補比較パネル
- **完了**: 3シナリオすべてで plan-consistency と e2e が通る。索引を外すと Hash Join に切り替わることを e2e で確認

### M4: 仕上げ (任意)
- ORDER BY と索引順の対比シナリオ、バッファプールのヒット率表示、パフォーマンス計測 (60fps)
- モバイル警告

## Claude Code への依頼テンプレート

各マイルストーンは以下の形で依頼する (CLAUDE.md の検査ルールがそのまま通る形):

```
目的: M1 のエンジン実装 (docs/PLAN.md M1)
制約: apps/web は触らない。packages/engine は DOM 非依存を維持。依存追加は node-sql-parser と zod のみ
完了条件: docker compose up -d 後に pnpm check が通る。シナリオ1・2の plan-consistency テストが緑
出力形式: PR 相当の差分 + docs/FIDELITY.md の更新
```

## リスクと対策

| リスク | 対策 |
|---|---|
| コスト定数の調整で MySQL と選択が一致しない | M1 の段階で3シナリオ分の EXPLAIN を先に取得し、それに合わせて定数を決める (テスト駆動)。どうしても一致しない場合は FIDELITY.md の許容差分に登録し UI に明示 |
| 3D のパフォーマンス | Trace を全件生成した上で、描画は現在 index の**差分**だけ更新する。InstancedMesh でページタイルを描く |
| `node-sql-parser` の MySQL 方言差 | サポート範囲外は明示エラー (DESIGN.md §9)。パーサ差し替えできるよう内部 AST を自前定義 |
