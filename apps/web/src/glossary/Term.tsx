import type { StepEventType } from '@db-visualizer/engine';
import type { JSX, ReactNode } from 'react';
import { GLOSSARY_JA } from './ja.js';

/**
 * ホバー / フォーカスで用語解説を出す (DESIGN.md 5)。
 * 表示の出し分けは CSS だけで行う。JS の状態を持たないぶん、
 * 再生中に何度も再描画されても解説がちらつかない。
 */
export function Term({
  type,
  children,
}: {
  readonly type: StepEventType;
  readonly children: ReactNode;
}): JSX.Element {
  const glossary = GLOSSARY_JA[type];
  return (
    <button type="button" className="term" data-testid="term" data-term={type}>
      {children}
      <span className="term-tooltip" role="tooltip" data-testid="term-tooltip">
        <strong className="term-tooltip-title">{glossary.term}</strong>
        <span className="term-tooltip-summary">{glossary.summary}</span>
        <span className="term-tooltip-detail">{glossary.detail}</span>
        {glossary.mysqlTerm ? (
          <em className="term-tooltip-mysql">MySQL では: {glossary.mysqlTerm}</em>
        ) : null}
      </span>
    </button>
  );
}
