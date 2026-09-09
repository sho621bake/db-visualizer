/** 配列から必ず値を取り出す。範囲外はテストの前提が壊れているので即座に落とす。 */
export function nth<T>(list: readonly T[], index: number): T {
  const value = list.at(index);
  if (value === undefined) throw new Error(`index ${index} が範囲外です (長さ ${list.length})`);
  return value;
}

/** null / undefined でないことを前提に取り出す。 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} がありません`);
  return value;
}
