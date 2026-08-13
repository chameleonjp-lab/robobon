interface VisualSample {
  id: string;
  file: string;
  title: string;
  description: string;
}

const SAMPLES: VisualSample[] = [
  {
    id: 'sample.home.v1',
    file: 'home.svg',
    title: 'ホーム',
    description: '作品の目的と、次に押す操作を一つに絞る画面',
  },
  {
    id: 'sample.planner.v1',
    file: 'planner.svg',
    title: '作戦編集',
    description: '上から順に読む規則カードと、変更の結果を予想する画面',
  },
  {
    id: 'sample.battle.v1',
    file: 'battle.svg',
    title: '戦闘',
    description: '機体、弾道、危険区域、実行中の判断を同時に見る画面',
  },
  {
    id: 'sample.analysis.v1',
    file: 'analysis.svg',
    title: '分析',
    description: '観測事実と該当場面を結び、次の修正を選ぶ画面',
  },
];

function create<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function mountVisualGallery(root: HTMLElement): void {
  const section = create('section', 'visual-gallery');
  section.setAttribute('aria-labelledby', 'visual-gallery-title');

  const heading = create('h2');
  heading.id = 'visual-gallery-title';
  heading.textContent = 'P0-04 / 画面見本';
  const note = create('p', 'visual-gallery__note');
  note.textContent = '完成素材ではなく、4画面で共通の輪郭・余白・情報の優先順を確認するための見本です。';

  const list = create('div', 'visual-gallery__list');
  for (const sample of SAMPLES) {
    const figure = create('figure', 'visual-sample');
    const image = create('img');
    image.src = `${import.meta.env.BASE_URL}assets/visual-samples/${sample.file}`;
    image.alt = `${sample.title}画面の低精細な見本`;
    image.width = 320;
    image.height = 220;
    image.loading = 'lazy';
    image.decoding = 'async';
    const caption = create('figcaption');
    const title = create('strong');
    title.textContent = sample.title;
    const description = create('span');
    description.textContent = `${sample.id} — ${sample.description}`;
    caption.append(title, description);
    figure.append(image, caption);
    list.append(figure);
  }

  section.append(heading, note, list);
  root.append(section);
}

export { mountVisualGallery };
