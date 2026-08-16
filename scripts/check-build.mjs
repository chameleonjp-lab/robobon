import { access, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const indexPath = resolve('dist/index.html');
const html = await readFile(indexPath, 'utf8').catch((error) => {
  throw new Error(`dist/index.html を読めません: ${error.message}`);
});

const required = [
  '<meta name="viewport"',
  '/robobon/',
  '<link rel="manifest" href="/robobon/manifest.webmanifest"',
  '<script type="module"',
];

for (const marker of required) {
  if (!html.includes(marker)) {
    throw new Error(`配信物に必須の基準がありません: ${marker}`);
  }
}

const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
if (!cspMatch) throw new Error('配信物にContent Security Policyがありません');
for (const directive of [
  "default-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
]) {
  if (!cspMatch[1].split(';').map((value) => value.trim()).includes(directive)) {
    throw new Error(`Content Security Policyに必要な制限がありません: ${directive}`);
  }
}
if (html.indexOf('Content-Security-Policy') > html.indexOf('<link rel="manifest"')) {
  throw new Error('Content Security Policyは最初の配信リソースより前に置いてください');
}

const legacySlug = ['robo', 'bo'].join('');

if (html.includes(`/${legacySlug}/`) || new RegExp(`${legacySlug}(?!n)`, 'i').test(html)) {
  throw new Error('旧slugが配信物へ混入しています');
}

if (/<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i.test(html)) {
  throw new Error('外部のscript/linkを配信物へ追加しないでください');
}

if (html.includes('/src/main.ts')) {
  throw new Error('未ビルドのsrc/main.ts参照が残っています');
}

const requiredAssets = [
  'manifest.webmanifest',
  'assets/asset-manifest.json',
  'assets/visual-samples/home.svg',
  'assets/visual-samples/planner.svg',
  'assets/visual-samples/battle.svg',
  'assets/visual-samples/analysis.svg',
];

for (const asset of requiredAssets) {
  await access(resolve('dist', asset)).catch(() => {
    throw new Error(`必須の見本素材が配信物にありません: ${asset}`);
  });
}

const assetManifestPath = resolve('dist/assets/asset-manifest.json');
const assetManifest = JSON.parse(await readFile(assetManifestPath, 'utf8'));
if (assetManifest.manifestVersion !== 1) {
  throw new Error(`asset-manifest.jsonのmanifestVersionが不正です: ${assetManifest.manifestVersion}`);
}
if (assetManifest.gameId !== 'chameleonjp-lab.robobon.v1') {
  throw new Error(`asset-manifest.jsonのgameIdが不正です: ${assetManifest.gameId}`);
}
if (!Array.isArray(assetManifest.assets) || assetManifest.assets.length === 0) {
  throw new Error('asset-manifest.jsonのassetsが空、または配列ではありません');
}

const catalog = await readFile(resolve('docs/ASSET_CATALOG.md'), 'utf8');
const distRoot = resolve('dist');
const manifestIds = new Set();
const manifestPaths = new Set();
for (const asset of assetManifest.assets) {
  for (const key of ['id', 'path', 'kind', 'status', 'source', 'rights']) {
    if (typeof asset[key] !== 'string' || asset[key].trim() === '') {
      throw new Error(`asset-manifest.jsonの${key}が空です: ${JSON.stringify(asset)}`);
    }
  }
  for (const key of ['width', 'height']) {
    if (!Number.isSafeInteger(asset[key]) || asset[key] <= 0) {
      throw new Error(`asset-manifest.jsonの${key}が安全な正整数ではありません: ${JSON.stringify(asset)}`);
    }
  }
  if (!asset.path.startsWith('assets/') || asset.path.includes('\\') || asset.path.split('/').includes('..')) {
    throw new Error(`asset-manifest.jsonのpathが配信範囲外です: ${asset.path}`);
  }
  if (manifestIds.has(asset.id)) throw new Error(`asset-manifest.jsonのIDが重複しています: ${asset.id}`);
  if (manifestPaths.has(asset.path)) throw new Error(`asset-manifest.jsonのpathが重複しています: ${asset.path}`);
  manifestIds.add(asset.id);
  manifestPaths.add(asset.path);
  if (!catalog.includes(`\`${asset.id}\``) || !catalog.includes(`\`${asset.path.replace(/^assets\//, 'public/assets/')}\``)) {
    throw new Error(`素材台帳にasset-manifest.jsonの記載がありません: ${asset.id}`);
  }
  const resolvedAssetPath = resolve(distRoot, asset.path);
  const relativeAssetPath = relative(distRoot, resolvedAssetPath);
  if (isAbsolute(relativeAssetPath) || relativeAssetPath === '..' || relativeAssetPath.startsWith(`..${sep}`)) {
    throw new Error(`asset-manifest.jsonのpathが配信範囲外です: ${asset.path}`);
  }
  await access(resolvedAssetPath).catch(() => {
    throw new Error(`asset-manifest.jsonの素材が配信物にありません: ${asset.path}`);
  });
  if (asset.path.endsWith('.svg')) {
    const svg = await readFile(resolvedAssetPath, 'utf8');
    const rootMatch = svg.match(/^\s*<svg\b([^>]*)>/i);
    if (!rootMatch) throw new Error(`SVGのroot要素がありません: ${asset.path}`);
    const rootAttributes = rootMatch[1];
    const viewBoxMatch = rootAttributes.match(/\bviewBox=["']([^"']+)["']/i);
    const viewBox = viewBoxMatch?.[1].trim().split(/[\s,]+/).map(Number);
    if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) ||
      viewBox[0] !== 0 || viewBox[1] !== 0 || viewBox[2] !== asset.width || viewBox[3] !== asset.height) {
      throw new Error(`SVGのviewBoxとmanifest寸法が一致しません: ${asset.path}`);
    }
    for (const marker of ['role="img"', 'aria-labelledby=']) {
      if (!rootAttributes.includes(marker)) throw new Error(`SVGのアクセシビリティ属性がありません: ${asset.path}`);
    }
    if (!/<title\b[^>]*>[^<]+<\/title>/i.test(svg) || !/<desc\b[^>]*>[^<]+<\/desc>/i.test(svg)) {
      throw new Error(`SVGにtitle/descがありません: ${asset.path}`);
    }
    if (/<(?:script|foreignObject|image)\b/i.test(svg) || /(?:href|xlink:href)=["'](?:https?:|data:)/i.test(svg)) {
      throw new Error(`SVGに許可しない埋め込みまたは外部参照があります: ${asset.path}`);
    }
  }
}

const visualSampleRoot = resolve('dist/assets/visual-samples');
const visualSampleFiles = (await readdir(visualSampleRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.svg'))
  .map((entry) => `assets/visual-samples/${entry.name}`);
for (const assetPath of visualSampleFiles) {
  if (!manifestPaths.has(assetPath)) {
    throw new Error(`素材manifestに未登録の見本素材があります: ${assetPath}`);
  }
}
for (const assetPath of manifestPaths) {
  if (assetPath.startsWith('assets/visual-samples/') && !visualSampleFiles.includes(assetPath)) {
    throw new Error(`素材manifestに登録済みですが配信フォルダにありません: ${assetPath}`);
  }
}

const manifest = JSON.parse(await readFile(resolve('dist/manifest.webmanifest'), 'utf8'));
for (const [key, expected] of [
  ['name', 'ロボボン'],
  ['short_name', 'ロボボン'],
  ['id', '/robobon/'],
  ['start_url', '/robobon/'],
  ['scope', '/robobon/'],
  ['display', 'standalone'],
  ['orientation', 'portrait'],
]) {
  if (manifest[key] !== expected) throw new Error(`manifest.webmanifestの${key}が不正です: ${manifest[key]}`);
}

console.log('build smoke check passed: /robobon/');
