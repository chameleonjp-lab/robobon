import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const indexPath = resolve('dist/index.html');
const html = await readFile(indexPath, 'utf8').catch((error) => {
  throw new Error(`dist/index.html を読めません: ${error.message}`);
});

const required = [
  '<meta name="viewport"',
  '/robobon/',
  '<script type="module"',
];

for (const marker of required) {
  if (!html.includes(marker)) {
    throw new Error(`配信物に必須の基準がありません: ${marker}`);
  }
}

if (html.includes('/robobo/') || /robobo(?!n)/i.test(html)) {
  throw new Error('旧slugが配信物へ混入しています: robobo');
}

if (/<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i.test(html)) {
  throw new Error('外部のscript/linkを配信物へ追加しないでください');
}

if (html.includes('/src/main.ts')) {
  throw new Error('未ビルドのsrc/main.ts参照が残っています');
}

console.log('build smoke check passed: /robobon/');
