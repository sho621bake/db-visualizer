import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library の自動クリーンアップはグローバル afterEach が要るのでここで登録する。
afterEach(cleanup);
