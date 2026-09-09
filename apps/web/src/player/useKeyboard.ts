import { useEffect } from 'react';
import type { PlayerStore } from './store.js';

/** 入力中のキーはプレイヤーに奪わせない (SQLエディタが最優先)。 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Space=再生/停止, ←/→=1ステップ (DESIGN.md 5)。 */
export function usePlayerKeyboard(store: PlayerStore): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const { toggle, step } = store.getState();
      switch (event.key) {
        case ' ':
          event.preventDefault();
          toggle();
          break;
        case 'ArrowRight':
          event.preventDefault();
          step(1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          step(-1);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);
}
