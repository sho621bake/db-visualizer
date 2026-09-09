import type { PlanCandidate, PlanNode, Row, StepEvent, Trace, Value } from '@db-visualizer/engine';

/**
 * Trace の 0..index 番目までを適用した「画面が描くべき状態」(DESIGN.md 5)。
 *
 * この関数は DOM も three.js も知らない純関数で、検証用の DOM (M2-A) と
 * 3Dシーン (M2-B) の両方がここだけを読む。スクラブで任意位置へ飛べるように、
 * 状態は必ず 0..index の畳み込みで決まり、履歴に依存しない。
 */

export interface PageState {
  readonly pageId: string;
  readonly table: string;
  readonly index: string;
  /** 読んだ回数 (再読を含む)。 */
  readonly reads: number;
  /** うちディスクから読んだ回数。0 ならバッファプールにずっと載っていた。 */
  readonly diskReads: number;
  readonly lastSource: 'bufferpool' | 'disk';
  readonly lastSeq: number;
}

/** 現在の索引探索でルートから降りてきた経路。level は単調減少し、0 がリーフ。 */
export interface BTreeNodeState {
  readonly index: string;
  readonly level: number;
  readonly pageId: string;
}

export interface LeafScanState {
  readonly index: string;
  readonly pageId: string;
  readonly fromKey: readonly Value[] | null;
  readonly toKey: readonly Value[] | null;
}

/** セカンダリ索引 → クラスタ索引の「戻り」。可視化の中心 (DESIGN.md 4.1)。 */
export interface LookupState {
  readonly table: string;
  readonly pk: Value;
  readonly from: string;
  readonly seq: number;
}

/**
 * 現在位置までの集計。`stats` イベントが出る前でも数えられるので、
 * スクラブ中もフッタの数字が動く。
 *
 * `rowsRead` は `row.read` の件数。カバリングでないセカンダリ走査は行本体を
 * 持たず `row.read` を出さないため、MySQL の rows_examined とは一致しないことがある
 * (最終値は `stats.rowsExamined` を使う)。
 */
export interface Counters {
  readonly pagesRead: number;
  readonly diskReads: number;
  readonly bufferHits: number;
  readonly rowsRead: number;
  readonly rowsEmitted: number;
}

export interface StatsState {
  readonly pagesRead: number;
  readonly diskReads: number;
  readonly rowsExamined: number;
  readonly rowsReturned: number;
}

/** 現在のイベントが「今まさに触っているもの」。強調表示に使う。 */
export interface Focus {
  readonly nodeId: string | null;
  readonly pageId: string | null;
  readonly index: string | null;
  readonly pk: Value | null;
}

export interface SceneState {
  /** クランプ済みの現在位置。-1 は「まだ何も起きていない」。 */
  readonly index: number;
  readonly event: StepEvent | null;
  readonly plan: PlanNode | null;
  readonly candidates: readonly PlanCandidate[];
  readonly pages: readonly PageState[];
  readonly btreePath: readonly BTreeNodeState[];
  readonly leafScan: LeafScanState | null;
  readonly lookup: LookupState | null;
  readonly rows: readonly Row[];
  readonly filter: { readonly passed: number; readonly rejected: number };
  readonly counters: Counters;
  readonly stats: StatsState | null;
  /** 現在のイベントが今まさに触っているもの。 */
  readonly focus: Focus;
}

const EMPTY_FOCUS: Focus = { nodeId: null, pageId: null, index: null, pk: null };

function focusOf(event: StepEvent): Focus {
  const base = { ...EMPTY_FOCUS, nodeId: event.nodeId };
  switch (event.type) {
    case 'page.read':
      return { ...base, pageId: event.pageId, index: event.index };
    case 'btree.descend':
    case 'btree.leaf.scan':
      return { ...base, pageId: event.pageId, index: event.index };
    case 'row.read':
    case 'clustered.lookup':
    case 'filter.eval':
      return { ...base, pk: event.pk };
    default:
      return base;
  }
}

/** `index` までを畳み込む。範囲外はクランプする (-1 = 初期状態)。 */
export function sceneStateAt(trace: Trace, index: number): SceneState {
  const at = Math.min(Math.max(index, -1), trace.length - 1);

  let plan: PlanNode | null = null;
  let candidates: readonly PlanCandidate[] = [];
  const pages: PageState[] = [];
  const pageAt = new Map<string, number>();
  let btreePath: BTreeNodeState[] = [];
  let leafScan: LeafScanState | null = null;
  let lookup: LookupState | null = null;
  const rows: Row[] = [];
  let passed = 0;
  let rejected = 0;
  let pagesRead = 0;
  let diskReads = 0;
  let rowsRead = 0;
  let stats: StatsState | null = null;

  for (let i = 0; i <= at; i++) {
    const event = trace[i];
    if (!event) break;
    switch (event.type) {
      case 'plan.selected':
        plan = event.planTree;
        candidates = event.candidates;
        break;
      case 'page.read': {
        pagesRead += 1;
        const fromDisk = event.source === 'disk';
        if (fromDisk) diskReads += 1;
        const known = pageAt.get(event.pageId);
        if (known === undefined) {
          pageAt.set(event.pageId, pages.length);
          pages.push({
            pageId: event.pageId,
            table: event.table,
            index: event.index,
            reads: 1,
            diskReads: fromDisk ? 1 : 0,
            lastSource: event.source,
            lastSeq: event.seq,
          });
        } else {
          const prev = pages[known] as PageState;
          pages[known] = {
            ...prev,
            reads: prev.reads + 1,
            diskReads: prev.diskReads + (fromDisk ? 1 : 0),
            lastSource: event.source,
            lastSeq: event.seq,
          };
        }
        break;
      }
      case 'btree.descend': {
        const last = btreePath.at(-1);
        // level は 1 回の探索の中で単調減少する。下がらなければ別の探索が始まった。
        const continues =
          last !== undefined && last.index === event.index && event.level < last.level;
        const node = { index: event.index, level: event.level, pageId: event.pageId };
        btreePath = continues ? [...btreePath, node] : [node];
        break;
      }
      case 'btree.leaf.scan':
        leafScan = {
          index: event.index,
          pageId: event.pageId,
          fromKey: event.fromKey,
          toKey: event.toKey,
        };
        break;
      case 'row.read':
        rowsRead += 1;
        break;
      case 'clustered.lookup':
        lookup = { table: event.table, pk: event.pk, from: event.from, seq: event.seq };
        break;
      case 'filter.eval':
        if (event.passed) passed += 1;
        else rejected += 1;
        break;
      case 'row.emit':
        rows.push(event.row);
        break;
      case 'stats':
        stats = {
          pagesRead: event.pagesRead,
          diskReads: event.diskReads,
          rowsExamined: event.rowsExamined,
          rowsReturned: event.rowsReturned,
        };
        break;
      default:
        // join / hash / sort は M3 で扱う。今は状態を変えない。
        break;
    }
  }

  const event = at >= 0 ? (trace[at] ?? null) : null;
  return {
    index: at,
    event,
    plan,
    candidates,
    pages,
    btreePath,
    leafScan,
    lookup,
    rows,
    filter: { passed, rejected },
    counters: {
      pagesRead,
      diskReads,
      bufferHits: pagesRead - diskReads,
      rowsRead,
      rowsEmitted: rows.length,
    },
    stats,
    focus: event ? focusOf(event) : EMPTY_FOCUS,
  };
}
