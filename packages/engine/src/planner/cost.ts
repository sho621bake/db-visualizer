import { LEAF_ENTRIES } from '../storage/page.js';
import type { AccessType } from '../trace/events.js';

/**
 * 簡易コストモデル (DESIGN.md 4.2)。
 *
 *   cost = 推定ページ数 * IO_COST + 推定行数 * ROW_EVAL_COST
 *
 * 絶対値を MySQL に合わせることは目的ではない。**選択結果**が一致することを
 * plan-consistency テストで担保する (FIDELITY.md)。
 * 定数は Phase の EXPLAIN 実測 (シナリオ1: const、シナリオ2: カバリング索引) に
 * 合わせて決めた。MySQL の read_cost / eval_cost の比 (1.0 : 0.1) を踏襲している。
 */
export const IO_COST = 1.0;
export const ROW_EVAL_COST = 0.1;

export function leafPagesFor(rows: number): number {
  return Math.max(1, Math.ceil(rows / LEAF_ENTRIES));
}

export interface CostInput {
  readonly accessType: AccessType;
  /** 走査する索引の高さ (ルート〜リーフのレベル数)。 */
  readonly indexHeight: number;
  /** クラスタ索引の高さ。戻りコストの計算に使う。 */
  readonly clusteredHeight: number;
  /** テーブルの総行数。 */
  readonly tableRows: number;
  /** アクセスパスが返す推定行数。 */
  readonly estimatedRows: number;
  readonly covering: boolean;
}

export interface CostBreakdown {
  readonly pages: number;
  readonly cost: number;
}

export function estimateCost(input: CostInput): CostBreakdown {
  const { accessType, indexHeight, clusteredHeight, tableRows, estimatedRows, covering } = input;

  let pages: number;
  switch (accessType) {
    case 'ALL':
      // クラスタ索引のリーフを左から右へ全部読む
      pages = leafPagesFor(tableRows);
      break;
    case 'index':
      // セカンダリ索引のリーフを全部読む (カバリングのときだけ選ばれる)
      pages = leafPagesFor(tableRows);
      break;
    case 'const':
    case 'eq_ref':
    case 'ref':
    case 'range': {
      // descend で内部ノードを読み、リーフを推定行数ぶん読む
      pages = indexHeight - 1 + leafPagesFor(estimatedRows);
      break;
    }
  }

  // 非カバリングのセカンダリアクセスは、1行ごとにクラスタ索引へ戻る (可視化の中心)
  if (accessType !== 'ALL' && !covering) {
    pages += estimatedRows * clusteredHeight;
  }

  return { pages, cost: pages * IO_COST + estimatedRows * ROW_EVAL_COST };
}
