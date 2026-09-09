import { describe, expect, it } from 'vitest';
import { ENGINE_NAME } from '../src/index.js';

describe('エンジンのスモーク', () => {
  it('エンジン名を公開する', () => {
    expect(ENGINE_NAME).toBe('InnoDB Visualizer Engine');
  });
});
