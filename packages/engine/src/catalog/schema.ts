/** クラスタ索引 (PK の B+Tree) を指す名前。MySQL の EXPLAIN と同じ語を使う。 */
export const PRIMARY = 'PRIMARY';

export type ColumnType = 'int' | 'string' | 'datetime';

export interface ColumnDef {
  readonly name: string;
  readonly type: ColumnType;
}

export interface IndexDef {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

export interface TableDef {
  readonly name: string;
  readonly columns: readonly ColumnDef[];
  /** 単一列 PK のみ扱う (DESIGN.md §6 のシードはすべて単一列 PK)。 */
  readonly primaryKey: string;
  readonly indexes: readonly IndexDef[];
}

/**
 * tools/mysql/seed.sql の DDL と1対1で対応させる。
 * ここがずれると plan-consistency テストが落ちる。
 */
export const TABLES: Readonly<Record<string, TableDef>> = {
  users: {
    name: 'users',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'email', type: 'string' },
      { name: 'name', type: 'string' },
      { name: 'country', type: 'string' },
      { name: 'created_at', type: 'datetime' },
    ],
    primaryKey: 'id',
    indexes: [
      { name: 'idx_users_email', columns: ['email'], unique: true },
      { name: 'idx_users_country', columns: ['country'], unique: false },
    ],
  },
  products: {
    name: 'products',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'string' },
      { name: 'price', type: 'int' },
    ],
    primaryKey: 'id',
    indexes: [],
  },
  orders: {
    name: 'orders',
    columns: [
      { name: 'id', type: 'int' },
      { name: 'user_id', type: 'int' },
      { name: 'product_id', type: 'int' },
      { name: 'status', type: 'string' },
      { name: 'amount', type: 'int' },
    ],
    primaryKey: 'id',
    indexes: [
      { name: 'idx_orders_user', columns: ['user_id'], unique: false },
      { name: 'idx_orders_user_status', columns: ['user_id', 'status'], unique: false },
    ],
  },
};

export function tableDef(name: string): TableDef {
  const t = TABLES[name];
  if (!t) throw new Error(`未対応: テーブル ${name} は存在しません`);
  return t;
}

export function indexDef(table: TableDef, indexName: string): IndexDef {
  const idx = table.indexes.find((i) => i.name === indexName);
  if (!idx) throw new Error(`索引 ${indexName} は ${table.name} にありません`);
  return idx;
}
