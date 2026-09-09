import type { StepEventType } from '@db-visualizer/engine';

/**
 * StepEvent 種別 → 日本語の用語解説 (DESIGN.md 4.4)。
 *
 * 不変条件3: `Record<StepEvent['type'], Glossary>` で網羅を型が強制する。
 * エンジンに種別を足してここを更新し忘れると `tsc --noEmit` が落ちる。
 */
export interface Glossary {
  /** 画面に出す用語。 */
  readonly term: string;
  /** ホバー時の1文。 */
  readonly summary: string;
  /** 「何が起きたか」「なぜ重要か」。2〜4文。 */
  readonly detail: string;
  /** 対応する MySQL の概念名 (EXPLAIN の語など)。無ければ null。 */
  readonly mysqlTerm: string | null;
}

export const GLOSSARY_JA: Record<StepEventType, Glossary> = {
  'plan.selected': {
    term: '実行計画の確定',
    summary: 'オプティマイザが候補アクセスパスを比べ、最小コストの1本を選んだ。',
    detail:
      '各索引について「どのキー部まで条件を押し込めるか」「クラスタ索引に戻る必要があるか」を評価し、推定ページ数と推定行数からコストを出す。不採用の候補もコスト付きで残るので、なぜこの索引が選ばれたのかを比べられる。',
    mysqlTerm: 'EXPLAIN',
  },
  'page.read': {
    term: 'ページ読み込み',
    summary: 'ページを1枚読んだ。バッファプールにあれば緑、ディスクから読んだら赤。',
    detail:
      'InnoDB はページ単位で入出力する。同じページを再び読むときバッファプールに残っていればディスクI/Oは発生しない。索引が効いているクエリほど、触るページが少なくヒット率も上がる。',
    mysqlTerm: 'buffer pool / disk read',
  },
  'btree.descend': {
    term: 'B+Tree の下降',
    summary: 'ルートから目的のリーフへ向けて1レベル降りた。',
    detail:
      '内部ノードは「このキー以上の子はこちら」という道しるべしか持たない。木の高さぶんページを読んでからリーフに着く。行数が増えて木が高くなると、1件引くための固定コストが増える。',
    mysqlTerm: 'B+Tree descent',
  },
  'btree.leaf.scan': {
    term: 'リーフの横走査',
    summary: 'リーフページを左から右へ、範囲の終わりまで舐めた。',
    detail:
      'リーフ同士は右隣へリンクされているので、範囲検索は下降1回のあと横に走るだけで済む。これが range アクセスがフルスキャンより速い理由。走る幅が広いほど読むページも増える。',
    mysqlTerm: 'range scan',
  },
  'row.read': {
    term: '行の読み出し',
    summary: 'ページの中から行を1件取り出した。',
    detail:
      'クラスタ索引のリーフには行本体があるのでそのまま読める。カバリング索引の場合はセカンダリ索引のリーフだけで必要な列が揃うため、こちらも行として扱える。この件数が EXPLAIN の rows_examined に対応する。',
    mysqlTerm: 'rows_examined',
  },
  'clustered.lookup': {
    term: 'クラスタ索引への戻り',
    summary: 'セカンダリ索引から PK を頼りにクラスタ索引へ行本体を取りに戻った。',
    detail:
      'InnoDB のセカンダリ索引のリーフは (索引キー, PK) しか持たない。索引に無い列が必要になると、1行ごとにクラスタ索引を根から引き直すことになる。これが「索引は効いているのに遅い」の主因で、必要列を索引に含める (カバリング索引) と丸ごと消える。',
    mysqlTerm: 'clustered index lookup',
  },
  'filter.eval': {
    term: '条件の評価',
    summary: '取り出した行に WHERE 条件をあてて、通過か棄却かを決めた。',
    detail:
      '索引に押し込めなかった条件はここで評価する。棄却された行のぶんだけ読み出しが無駄になっているので、棄却が多いなら索引の選び方を見直す合図になる。EXPLAIN では Using where として現れる。',
    mysqlTerm: 'Using where',
  },
  'join.probe': {
    term: 'JOIN の照合',
    summary: '駆動表の1行を内部表に当てて、対応する行を探した。',
    detail:
      'Nested Loop Join では駆動表の行ごとに内部表を引く。内部表に使える索引があればこの引き直しが安く済み、無ければ全走査になるためコストが跳ね上がる。(M3 で実装)',
    mysqlTerm: 'Nested Loop Join',
  },
  'hash.build': {
    term: 'ハッシュ表の構築',
    summary: '小さい方の表を読み切って、結合キーでハッシュ表に積んだ。',
    detail:
      '内部表に使える索引が無いとき、MySQL 8.0.18 以降は Hash Join を選ぶ。まず片方を全部メモリに載せる (build 相)。ここが済むまで結果は1行も出ない。(M3 で実装)',
    mysqlTerm: 'Hash Join (build)',
  },
  'hash.probe': {
    term: 'ハッシュ表の探索',
    summary: 'もう一方の表の行で、ハッシュ表のバケットを引いた。',
    detail:
      'build 相で作った表をキーで直接引くので、1行あたりの探索は木を降りるより安い。ただしメモリに載り切らないとディスクへ溢れる。(M3 で実装)',
    mysqlTerm: 'Hash Join (probe)',
  },
  'sort.buffer': {
    term: 'ソートバッファへの積み込み',
    summary: '並べ替えのために行をソートバッファへ溜めた。',
    detail:
      '索引の順序で ORDER BY を満たせないとき、行を全部集めてから並べ替える。読み終わるまで1行も返せないので、LIMIT があっても早期終了できない。(M3 で実装)',
    mysqlTerm: 'Using filesort',
  },
  'sort.emit': {
    term: 'ソート結果の出力',
    summary: '並べ替えた結果を先頭から順に出した。',
    detail:
      'ソートが終わって初めて結果が流れ出す。索引順で取れるなら filesort ごと消せるので、ORDER BY の列を索引の並びに合わせられないか検討する価値がある。(M3 で実装)',
    mysqlTerm: 'Using filesort',
  },
  'row.emit': {
    term: '結果行の出力',
    summary: '1行がクライアントに返る結果集合へ到着した。',
    detail:
      'ここまで到達した行だけが SELECT の結果になる。読み出した行数 (rows_examined) との差が大きいほど、無駄に読んでいることになる。',
    mysqlTerm: 'rows_sent',
  },
  stats: {
    term: '実行の集計',
    summary: '読んだページ数・ディスクI/O 回数・読み出した行数・返した行数のまとめ。',
    detail:
      '索引あり/なしを比べる指標。同じ結果集合でも、読んだページ数とディスクI/O が桁で変わることを確かめるための数字。',
    mysqlTerm: 'Handler_* / rows_examined',
  },
};
