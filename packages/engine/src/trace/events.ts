import { z } from 'zod';

/**
 * StepEvent スキーマ (DESIGN.md 4.4)。
 *
 * すべてのイベントは `{ seq, type, nodeId, ...payload }`。
 * `nodeId` は PlanTree のノード id を指す。DESIGN.md の表で `btree.descend` の payload に
 * 書かれている `nodeId` は「B+Tree のノード」の意味だが、基底の `nodeId` と衝突するため
 * ここでは `pageId` という名前で持つ。
 *
 * 種別を追加するときは .claude/skills/add-trace-event/SKILL.md の手順に従うこと。
 * (追加すると用語集の網羅が破れて tsc が落ちる = 不変条件3)
 */

const valueSchema = z.union([z.string(), z.number()]);
const keySchema = z.array(valueSchema);
const rowSchema = z.record(z.string(), valueSchema);

export const accessTypeSchema = z.enum(['ALL', 'index', 'range', 'ref', 'eq_ref', 'const']);
export type AccessType = z.infer<typeof accessTypeSchema>;

/** PlanTree のノード。`plan.selected` の payload に丸ごと載る。 */
export const planNodeSchema = z.object({
  id: z.string(),
  op: z.enum([
    'TableScan',
    'IndexRangeScan',
    'IndexLookup',
    'ClusteredLookup',
    'Filter',
    'Projection',
    'Limit',
    'NestedLoopJoin',
    'HashJoin',
    'Sort',
  ]),
  label: z.string(),
  table: z.string().optional(),
  index: z.string().optional(),
  accessType: accessTypeSchema.optional(),
  covering: z.boolean().optional(),
  estimatedRows: z.number().optional(),
  cost: z.number().optional(),
  get children() {
    return z.array(planNodeSchema);
  },
});
export type PlanNode = z.infer<typeof planNodeSchema>;

/** 不採用も含めたアクセスパス候補 (DESIGN.md 4.2 の候補比較パネル用)。 */
export const candidateSchema = z.object({
  table: z.string(),
  accessType: accessTypeSchema,
  index: z.string().nullable(),
  covering: z.boolean(),
  estimatedRows: z.number(),
  cost: z.number(),
  chosen: z.boolean(),
  reason: z.string(),
});
export type PlanCandidate = z.infer<typeof candidateSchema>;

const base = { seq: z.number().int().nonnegative(), nodeId: z.string() };

export const stepEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('plan.selected'),
    planTree: planNodeSchema,
    candidates: z.array(candidateSchema),
  }),
  z.object({
    ...base,
    type: z.literal('page.read'),
    table: z.string(),
    index: z.string(),
    pageId: z.string(),
    source: z.enum(['bufferpool', 'disk']),
  }),
  z.object({
    ...base,
    type: z.literal('btree.descend'),
    index: z.string(),
    level: z.number().int().nonnegative(),
    pageId: z.string(),
    searchKey: keySchema,
  }),
  z.object({
    ...base,
    type: z.literal('btree.leaf.scan'),
    index: z.string(),
    pageId: z.string(),
    fromKey: keySchema.nullable(),
    toKey: keySchema.nullable(),
  }),
  z.object({ ...base, type: z.literal('row.read'), table: z.string(), pk: valueSchema }),
  z.object({
    ...base,
    type: z.literal('clustered.lookup'),
    table: z.string(),
    pk: valueSchema,
    from: z.string(),
  }),
  z.object({ ...base, type: z.literal('filter.eval'), pk: valueSchema, passed: z.boolean() }),
  z.object({
    ...base,
    type: z.literal('join.probe'),
    side: z.enum(['driving', 'inner']),
    key: keySchema,
    matched: z.boolean(),
  }),
  z.object({ ...base, type: z.literal('hash.build'), key: keySchema, bucket: z.number().int() }),
  z.object({ ...base, type: z.literal('hash.probe'), key: keySchema, bucket: z.number().int() }),
  z.object({ ...base, type: z.literal('sort.buffer'), rows: z.array(rowSchema) }),
  z.object({ ...base, type: z.literal('sort.emit'), rows: z.array(rowSchema) }),
  z.object({ ...base, type: z.literal('row.emit'), row: rowSchema }),
  z.object({
    ...base,
    type: z.literal('stats'),
    pagesRead: z.number().int().nonnegative(),
    diskReads: z.number().int().nonnegative(),
    rowsExamined: z.number().int().nonnegative(),
    rowsReturned: z.number().int().nonnegative(),
  }),
]);

export type StepEvent = z.infer<typeof stepEventSchema>;
export type StepEventType = StepEvent['type'];

/** `seq` はコレクタが採番するため、emit 時は seq を持たない。 */
export type StepEventInput = {
  [E in StepEvent as E['type']]: Omit<E, 'seq'>;
}[StepEventType];

export const traceSchema = z.array(stepEventSchema);
export type Trace = readonly StepEvent[];

/** M1 で実際に emit される種別。JOIN / hash / sort は M3 で追加する。 */
export const M1_EVENT_TYPES = [
  'plan.selected',
  'page.read',
  'btree.descend',
  'btree.leaf.scan',
  'row.read',
  'clustered.lookup',
  'filter.eval',
  'row.emit',
  'stats',
] as const satisfies readonly StepEventType[];
