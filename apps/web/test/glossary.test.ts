import { run, SCENARIOS, stepEventSchema } from '@db-visualizer/engine';
import { describe, expect, it } from 'vitest';
import { GLOSSARY_JA } from '../src/glossary/ja.js';

/**
 * 不変条件3 は `Record<StepEvent['type'], Glossary>` で tsc が保証する。
 * ここでは「型は通るが中身が空」を防ぐ実行時の最低限だけを見る。
 */
describe('用語解説 (ja)', () => {
  it('StepEvent の全種別を網羅している', () => {
    const types = stepEventSchema.options.map((o) => o.shape.type.value as string);
    expect(Object.keys(GLOSSARY_JA).sort()).toEqual([...types].sort());
  });

  it('どの項目も term / summary / detail が空でない', () => {
    for (const [type, g] of Object.entries(GLOSSARY_JA)) {
      expect(g.term, type).not.toBe('');
      expect(g.summary.length, type).toBeGreaterThan(5);
      expect(g.detail.length, type).toBeGreaterThan(20);
    }
  });

  it('M1 のシナリオで出るイベントには必ず解説がある', () => {
    for (const s of SCENARIOS) {
      for (const event of run(s.sql, s.options).trace) {
        expect(GLOSSARY_JA[event.type], `${s.fixture} / ${event.type}`).toBeDefined();
      }
    }
  });
});
