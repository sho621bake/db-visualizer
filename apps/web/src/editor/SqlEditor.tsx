import { MySQL, sql } from '@codemirror/lang-sql';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { type JSX, useEffect, useRef } from 'react';

/**
 * CodeMirror 6 (MySQL 方言) の薄いラッパ (DESIGN.md 2)。
 *
 * value が外から変わったとき (プリセット選択) だけ文書を差し替える。
 * 打鍵ごとの再構築はカーソルが飛ぶので行わない。
 */
export function SqlEditor({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  // 構築は1度きり。以降の value 同期は下の effect が dispatch で行う
  const initialDoc = useRef(value);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: initialDoc.current,
        extensions: [
          basicSetup,
          sql({ dialect: MySQL }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === value) return;
    editor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  return <div className="sql-editor" data-testid="sql-editor" ref={host} />;
}
