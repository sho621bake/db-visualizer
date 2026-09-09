/** DESIGN.md §5: 色は3系統に固定し、凡例を常時表示する。 */
export type LegendItem = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
};

export const LEGEND: readonly LegendItem[] = [
  { id: 'disk-io', label: 'ディスクI/O', color: '#d9534f' },
  { id: 'buffer-hit', label: 'バッファプールヒット', color: '#3f9e5a' },
  { id: 'rejected', label: '棄却', color: '#8a8a8a' },
];
