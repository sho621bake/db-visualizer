#!/usr/bin/env node
// 決定論シード生成器。
// 固定シードの mulberry32 から users/orders/products を生成し、
//   1. tools/mysql/seed.sql                              (実 MySQL コンテナの初期化 DDL/DML)
//   2. packages/engine/src/catalog/seed-data.generated.ts (エンジンが読む行データ)
// の両方を「1つの生成器」から出力する。DESIGN.md §6「同一のDDL/DMLファイルを共有」の実装形。
// エンジンはブラウザでも動くため実行時のファイル読み込みは避け、両生成物をコミットして
// tools/mysql/test/seed-regeneration.test.ts でバイト一致を担保する。

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const SEED = 0x1f2e3d4c;

/** mulberry32: 32bit 固定シードの決定論 PRNG */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const randInt = (min, max) => min + Math.floor(rand() * (max - min + 1));

const FIRST_NAMES = [
  'Aoi',
  'Haru',
  'Yuna',
  'Sora',
  'Riku',
  'Mei',
  'Kaito',
  'Hina',
  'Ren',
  'Saki',
  'Yuto',
  'Nao',
  'Itsuki',
  'Rin',
  'Kenta',
  'Miu',
];
const LAST_NAMES = [
  'Sato',
  'Suzuki',
  'Takahashi',
  'Tanaka',
  'Ito',
  'Watanabe',
  'Yamamoto',
  'Nakamura',
  'Kobayashi',
  'Kato',
  'Yoshida',
  'Yamada',
  'Sasaki',
  'Matsumoto',
  'Inoue',
  'Kimura',
];
// country は JP を約 20% にする (DESIGN §7 シナリオ3 で users を駆動表にするため)。
const COUNTRY_POOL = ['JP', 'JP', 'US', 'US', 'GB', 'DE', 'FR', 'BR', 'IN', 'CA'];
const STATUSES = ['pending', 'paid', 'shipped', 'cancelled'];
const PRODUCT_NAMES = [
  'Keyboard',
  'Mouse',
  'Monitor',
  'Laptop',
  'Desk',
  'Chair',
  'Lamp',
  'Cable',
  'Adapter',
  'Speaker',
  'Headset',
  'Webcam',
  'Router',
  'Switch',
  'Drive',
  'Case',
];

const USER_COUNT = 200;
const ORDER_COUNT = 2000;
const PRODUCT_COUNT = 50;

const users = [];
for (let id = 1; id <= USER_COUNT; id++) {
  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);
  users.push({
    id,
    // email は UNIQUE 索引が張られるため id を混ぜて衝突を避ける
    email: `${first.toLowerCase()}.${last.toLowerCase()}${id}@example.com`,
    name: `${first} ${last}`,
    country: pick(COUNTRY_POOL),
    created_at: `2024-01-01 00:00:00`,
  });
}

const products = [];
for (let id = 1; id <= PRODUCT_COUNT; id++) {
  products.push({
    id,
    name: `${pick(PRODUCT_NAMES)} ${id}`,
    price: randInt(500, 50000),
  });
}

const orders = [];
for (let id = 1; id <= ORDER_COUNT; id++) {
  orders.push({
    id,
    user_id: randInt(1, USER_COUNT),
    product_id: randInt(1, PRODUCT_COUNT),
    status: pick(STATUSES),
    amount: randInt(500, 50000),
  });
}

// ---- 出力 1: seed.sql -------------------------------------------------------

const sqlEscape = (v) =>
  typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;

function insertStatements(table, columns, rows, chunkSize = 100) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = chunk
      .map((r) => `  (${columns.map((c) => sqlEscape(r[c])).join(', ')})`)
      .join(',\n');
    out.push(
      `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES\n${values};`,
    );
  }
  return out.join('\n');
}

const seedSql = `-- GENERATED FILE. tools/mysql/generate-seed.mjs から生成。直接編集しないこと。
-- 再生成: pnpm seed:gen  (seed.sql と packages/engine/src/catalog/seed-data.generated.ts を同時に更新)

SET NAMES utf8mb4;

DROP TABLE IF EXISTS \`orders\`;
DROP TABLE IF EXISTS \`products\`;
DROP TABLE IF EXISTS \`users\`;

CREATE TABLE \`users\` (
  \`id\` INT NOT NULL,
  \`email\` VARCHAR(191) NOT NULL,
  \`name\` VARCHAR(191) NOT NULL,
  \`country\` CHAR(2) NOT NULL,
  \`created_at\` DATETIME NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`idx_users_email\` (\`email\`),
  KEY \`idx_users_country\` (\`country\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE \`products\` (
  \`id\` INT NOT NULL,
  \`name\` VARCHAR(191) NOT NULL,
  \`price\` INT NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE \`orders\` (
  \`id\` INT NOT NULL,
  \`user_id\` INT NOT NULL,
  \`product_id\` INT NOT NULL,
  \`status\` VARCHAR(16) NOT NULL,
  \`amount\` INT NOT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_orders_user\` (\`user_id\`),
  KEY \`idx_orders_user_status\` (\`user_id\`, \`status\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

${insertStatements('users', ['id', 'email', 'name', 'country', 'created_at'], users)}

${insertStatements('products', ['id', 'name', 'price'], products)}

${insertStatements('orders', ['id', 'user_id', 'product_id', 'status', 'amount'], orders)}

ANALYZE TABLE \`users\`, \`products\`, \`orders\`;
`;

// ---- 出力 2: seed-data.generated.ts -----------------------------------------

const tsRows = (rows) => rows.map((r) => `  ${JSON.stringify(r)},`).join('\n');

const seedTs = `// GENERATED FILE. tools/mysql/generate-seed.mjs から生成。直接編集しないこと。
// 再生成: pnpm seed:gen
// 同じ生成器が tools/mysql/seed.sql も出力する。両者の一致は
// tools/mysql/test/seed-regeneration.test.ts で担保している。

export type UserRow = {
  id: number;
  email: string;
  name: string;
  country: string;
  created_at: string;
};

export type ProductRow = {
  id: number;
  name: string;
  price: number;
};

export type OrderRow = {
  id: number;
  user_id: number;
  product_id: number;
  status: string;
  amount: number;
};

export const USERS: readonly UserRow[] = [
${tsRows(users)}
];

export const PRODUCTS: readonly ProductRow[] = [
${tsRows(products)}
];

export const ORDERS: readonly OrderRow[] = [
${tsRows(orders)}
];
`;

const targets = [
  [join(ROOT, 'tools', 'mysql', 'seed.sql'), seedSql],
  [join(ROOT, 'packages', 'engine', 'src', 'catalog', 'seed-data.generated.ts'), seedTs],
];

export const GENERATED = Object.freeze({
  seedSql,
  seedTs,
  counts: { users: users.length, products: products.length, orders: orders.length },
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  for (const [path, content] of targets) {
    writeFileSync(path, content, 'utf8');
    console.log(`wrote ${path}`);
  }
}
