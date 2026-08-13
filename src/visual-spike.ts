type Quality = 'high' | 'medium' | 'low';
type Speed = 1 | 2;

const WORKLOAD = {
  robots: 2,
  bullets: 64,
  particles: 250,
} as const;

const QUALITY_PRESETS: Record<Quality, { label: string; particles: number; trails: boolean; shadows: boolean }> = {
  high: { label: '高', particles: 250, trails: true, shadows: true },
  medium: { label: '中', particles: 160, trails: true, shadows: false },
  low: { label: '低', particles: 64, trails: false, shadows: false },
};

const QUALITY_ORDER: Quality[] = ['high', 'medium', 'low'];

interface Atlas {
  canvas: HTMLCanvasElement;
  robotFriendly: { x: number; y: number; width: number; height: number };
  robotEnemy: { x: number; y: number; width: number; height: number };
  turret: { x: number; y: number; width: number; height: number };
  bullet: { x: number; y: number; width: number; height: number };
  particle: { x: number; y: number; width: number; height: number };
}

interface Metrics {
  frameTimes: number[];
  frames: number;
  startedAt: number;
  lastFrameAt: number;
  lastRenderMs: number;
}

interface SpikeElements {
  canvas: HTMLCanvasElement;
  status: HTMLParagraphElement;
  metrics: HTMLParagraphElement;
  quality: HTMLSelectElement;
  speed: HTMLSelectElement;
  reducedMotion: HTMLInputElement;
  start: HTMLButtonElement;
  stop: HTMLButtonElement;
  reset: HTMLButtonElement;
}

function makeElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

function makeLabel(text: string, control: HTMLElement): HTMLLabelElement {
  const label = makeElement('label', 'control');
  const caption = makeElement('span', 'control__caption');
  caption.textContent = text;
  label.append(caption, control);
  return label;
}

function createSelect<T extends string>(values: readonly T[], labels: Record<T, string>): HTMLSelectElement {
  const select = makeElement('select');
  for (const value of values) {
    const option = makeElement('option');
    option.value = value;
    option.textContent = labels[value];
    select.append(option);
  }
  return select;
}

function createAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('アトラス用Canvasを作成できません');

  const drawRobot = (x: number, fill: string, accent: string): void => {
    context.save();
    context.translate(x + 16, 32);
    context.fillStyle = 'rgb(0 0 0 / 22%)';
    context.beginPath();
    context.ellipse(0, 15, 13, 4, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = fill;
    context.beginPath();
    context.roundRect(-13, -11, 26, 22, 6);
    context.fill();
    context.strokeStyle = '#f8fafc';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = accent;
    context.fillRect(-8, -5, 16, 4);
    context.fillStyle = '#101820';
    context.fillRect(-9, 4, 5, 3);
    context.fillRect(4, 4, 5, 3);
    context.restore();
  };

  context.clearRect(0, 0, canvas.width, canvas.height);
  drawRobot(0, '#36c6d2', '#d9ffff');
  drawRobot(32, '#f39461', '#fff0dd');

  context.save();
  context.translate(86, 32);
  context.fillStyle = '#d9e5ef';
  context.fillRect(-2, -16, 4, 15);
  context.fillStyle = '#536b7d';
  context.beginPath();
  context.arc(0, 0, 8, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.fillStyle = '#f8fafc';
  context.beginPath();
  context.arc(112, 32, 4, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffd166';
  context.fillRect(128, 28, 8, 8);

  return {
    canvas,
    robotFriendly: { x: 0, y: 20, width: 32, height: 32 },
    robotEnemy: { x: 32, y: 20, width: 32, height: 32 },
    turret: { x: 78, y: 16, width: 16, height: 32 },
    bullet: { x: 108, y: 28, width: 8, height: 8 },
    particle: { x: 128, y: 28, width: 8, height: 8 },
  };
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function mountControls(root: HTMLElement): SpikeElements {
  const controls = makeElement('div', 'spike-controls');
  const quality = createSelect(QUALITY_ORDER, {
    high: '高: 250粒子・影・弾道',
    medium: '中: 160粒子・弾道',
    low: '低: 64粒子・重要情報のみ',
  });
  quality.value = 'high';
  const speed = createSelect(['1', '2'] as const, { '1': '1倍速', '2': '2倍速' });
  const reducedMotion = makeElement('input');
  reducedMotion.type = 'checkbox';
  reducedMotion.id = 'reduced-motion';
  const reducedLabel = makeLabel('演出を減らす', reducedMotion);
  reducedLabel.classList.add('control--check');

  const start = makeElement('button');
  start.type = 'button';
  start.textContent = '開始';
  const stop = makeElement('button');
  stop.type = 'button';
  stop.textContent = '停止';
  const reset = makeElement('button');
  reset.type = 'button';
  reset.textContent = '計測をリセット';

  controls.append(makeLabel('画質', quality), makeLabel('速度', speed), reducedLabel, start, stop, reset);

  const canvas = makeElement('canvas', 'spike-canvas');
  canvas.width = 360;
  canvas.height = 460;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'ロボット2機、弾64発、粒子250個を描画する負荷試作');
  const stage = makeElement('div', 'spike-stage');
  stage.append(canvas);

  const status = makeElement('p', 'spike-status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = '停止中。開始すると描画計測を始めます。';
  const metrics = makeElement('p', 'spike-metrics');
  metrics.textContent = '計測値: —';
  root.append(controls, stage, status, metrics);
  return { canvas, status, metrics, quality, speed, reducedMotion, start, stop, reset };
}

function mountVisualSpike(root: HTMLElement): void {
  const heading = makeElement('header', 'spike-heading');
  const eyebrow = makeElement('p', 'eyebrow');
  eyebrow.textContent = 'P0-03 / CANVAS RENDERING SPIKE';
  const title = makeElement('h1');
  title.textContent = '描画方式の負荷試作';
  const description = makeElement('p', 'spike-description');
  description.textContent = '本番の絵を作る前に、2機・弾64発・粒子250個・HUDをCanvas 2Dで重ねて測ります。';
  heading.append(eyebrow, title, description);

  const elements = mountControls(root);
  const context = elements.canvas.getContext('2d', { alpha: false });
  if (!context) {
    elements.status.textContent = 'Canvas 2Dを利用できないため、試作を開始できません。';
    elements.start.disabled = true;
    root.prepend(heading);
    return;
  }

  const atlas = createAtlas();
  const metrics: Metrics = { frameTimes: [], frames: 0, startedAt: 0, lastFrameAt: 0, lastRenderMs: 0 };
  let animationFrame = 0;
  let running = false;
  let elapsed = 0;
  let previousTime = 0;
  let lastMetricsUpdate = 0;

  const getQuality = (): Quality => {
    const selected = elements.quality.value as Quality;
    return QUALITY_ORDER.includes(selected) ? selected : 'high';
  };

  const resize = (): void => {
    const rect = elements.canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.round(rect.width || 360));
    const height = Math.max(400, Math.round(rect.height || 460));
    elements.canvas.width = Math.round(width * ratio);
    elements.canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const drawAtlasSprite = (
    source: { x: number; y: number; width: number; height: number },
    x: number,
    y: number,
    scale = 1,
    rotation = 0,
    alpha = 1,
  ): void => {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.globalAlpha = alpha;
    context.drawImage(atlas.canvas, source.x, source.y, source.width, source.height,
      -source.width * scale / 2, -source.height * scale / 2,
      source.width * scale, source.height * scale);
    context.restore();
  };

  const drawArena = (width: number, height: number, time: number): void => {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#162432');
    gradient.addColorStop(1, '#0c1118');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgb(131 169 190 / 14%)';
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += 32) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += 32) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.strokeStyle = 'rgb(217 255 255 / 22%)';
    context.strokeRect(16, 16, width - 32, height - 32);
    const hazardX = width * 0.5 + Math.sin(time * 0.001) * width * 0.18;
    context.fillStyle = 'rgb(255 93 108 / 16%)';
    context.beginPath();
    context.arc(hazardX, height * 0.58, 42, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = 'rgb(255 93 108 / 75%)';
    context.setLineDash([5, 5]);
    context.stroke();
    context.setLineDash([]);
  };

  const drawRobot = (x: number, y: number, heading: number, enemy: boolean, highQuality: boolean): void => {
    if (highQuality) {
      context.save();
      context.globalAlpha = 0.3;
      context.fillStyle = '#000';
      context.beginPath();
      context.ellipse(x, y + 16, 22, 7, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    drawAtlasSprite(enemy ? atlas.robotEnemy : atlas.robotFriendly, x, y, 1.2, heading);
    drawAtlasSprite(atlas.turret, x, y, 1, heading + Math.PI / 2);
    context.save();
    context.translate(x, y);
    context.rotate(heading);
    context.fillStyle = enemy ? '#fff0dd' : '#d9ffff';
    context.fillRect(8, -2, 18, 4);
    context.restore();
  };

  const drawBullets = (width: number, height: number, time: number, trails: boolean): void => {
    for (let index = 0; index < WORKLOAD.bullets; index += 1) {
      const lane = index % 8;
      const phase = time * 0.0008 + index * 0.43;
      const x = ((phase * 96 + lane * width / 8) % (width + 40)) - 20;
      const y = height * (0.23 + (index % 7) * 0.085) + Math.sin(phase * 1.7) * 5;
      if (trails) {
        context.save();
        context.globalAlpha = 0.24;
        context.strokeStyle = index % 2 === 0 ? '#b9ffff' : '#ffd3a8';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x - 12, y + 4);
        context.lineTo(x, y);
        context.stroke();
        context.restore();
      }
      drawAtlasSprite(atlas.bullet, x, y, 1, 0, 0.88);
    }
  };

  const drawParticles = (width: number, height: number, time: number, count: number): void => {
    for (let index = 0; index < count; index += 1) {
      const phase = time * 0.0011 + index * 0.197;
      const x = width * (0.15 + (Math.sin(index * 12.1) + 1) * 0.35) + Math.sin(phase) * 12;
      const y = height * (0.16 + (Math.cos(index * 2.7) + 1) * 0.33) + Math.cos(phase * 1.4) * 12;
      const alpha = 0.22 + (Math.sin(phase * 2) + 1) * 0.18;
      drawAtlasSprite(atlas.particle, x, y, 0.6 + (index % 3) * 0.2, phase, alpha);
    }
  };

  const drawHud = (width: number, height: number, quality: Quality): void => {
    const preset = QUALITY_PRESETS[quality];
    context.save();
    context.font = '600 12px system-ui, sans-serif';
    context.fillStyle = 'rgb(7 14 21 / 78%)';
    context.fillRect(12, height - 54, width - 24, 40);
    context.fillStyle = '#e7edf3';
    context.fillText('試験場 / DOCK-07', 24, height - 34);
    context.fillStyle = '#9fc4d6';
    context.fillText(`機体 ${WORKLOAD.robots}  弾 ${WORKLOAD.bullets}  粒子 ${preset.particles}`, 24, height - 17);
    context.fillStyle = '#b8a1ff';
    context.fillText(`画質 ${preset.label}`, width - 78, height - 17);
    context.restore();
  };

  const render = (time: number): void => {
    const rect = elements.canvas.getBoundingClientRect();
    const width = Math.max(320, rect.width || 360);
    const height = Math.max(400, rect.height || 460);
    const quality = elements.reducedMotion.checked ? 'low' : getQuality();
    const preset = QUALITY_PRESETS[quality];
    drawArena(width, height, time);
    drawBullets(width, height, time, preset.trails);
    drawParticles(width, height, time, preset.particles);
    const leftX = width * 0.3 + Math.sin(time * 0.0012) * 18;
    const leftY = height * 0.53 + Math.cos(time * 0.001) * 16;
    const rightX = width * 0.7 + Math.cos(time * 0.001) * 18;
    const rightY = height * 0.38 + Math.sin(time * 0.0013) * 16;
    drawRobot(leftX, leftY, time * 0.0007, false, preset.shadows);
    drawRobot(rightX, rightY, Math.PI + time * 0.0008, true, preset.shadows);
    drawHud(width, height, quality);
  };

  const updateMetrics = (): void => {
    const elapsedMs = Math.max(1, performance.now() - metrics.startedAt);
    const fps = metrics.frames * 1000 / elapsedMs;
    const p50 = percentile(metrics.frameTimes, 0.5);
    const p95 = percentile(metrics.frameTimes, 0.95);
    const p99 = percentile(metrics.frameTimes, 0.99);
    const over33 = metrics.frameTimes.length === 0 ? 0 : metrics.frameTimes.filter((value) => value > 33.3).length * 100 / metrics.frameTimes.length;
    const over50 = metrics.frameTimes.length === 0 ? 0 : metrics.frameTimes.filter((value) => value > 50).length * 100 / metrics.frameTimes.length;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    elements.metrics.textContent = [
      `計測 ${metrics.frames} frames / ${fps.toFixed(1)} fps`,
      `描画 p50 ${formatMs(p50)}・p95 ${formatMs(p95)}・p99 ${formatMs(p99)}`,
      `33.3ms超 ${over33.toFixed(2)}%・50ms超 ${over50.toFixed(2)}%・倍率 ${ratio}x`,
    ].join('　');
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(animationFrame);
    elements.status.textContent = '停止中。表示を止めても、最後の計測値は残ります。';
  };

  const start = (): void => {
    if (running) return;
    running = true;
    const now = performance.now();
    previousTime = now;
    if (metrics.startedAt === 0) metrics.startedAt = now;
    elements.status.textContent = '計測中。画質を変えると次のフレームから反映します。';
    animationFrame = requestAnimationFrame(frame);
  };

  const reset = (): void => {
    stop();
    metrics.frameTimes.length = 0;
    metrics.frames = 0;
    metrics.startedAt = 0;
    metrics.lastFrameAt = 0;
    metrics.lastRenderMs = 0;
    elapsed = 0;
    resize();
    render(0);
    elements.metrics.textContent = '計測値: —';
    elements.status.textContent = '停止中。計測をリセットしました。';
  };

  function frame(now: number): void {
    if (!running) return;
    const delta = Math.min(100, Math.max(0, now - previousTime));
    previousTime = now;
    const speed = Number(elements.speed.value) as Speed;
    elapsed += delta * speed;
    const started = performance.now();
    render(elapsed);
    const renderMs = performance.now() - started;
    metrics.lastRenderMs = renderMs;
    metrics.lastFrameAt = now;
    metrics.frames += 1;
    metrics.frameTimes.push(renderMs);
    if (metrics.frameTimes.length > 1800) metrics.frameTimes.shift();
    if (now - lastMetricsUpdate > 250) {
      updateMetrics();
      lastMetricsUpdate = now;
    }
    animationFrame = requestAnimationFrame(frame);
  }

  elements.start.addEventListener('click', start);
  elements.stop.addEventListener('click', stop);
  elements.reset.addEventListener('click', reset);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stop();
      previousTime = performance.now();
      elements.status.textContent = '背後へ移動したため停止しました。再開時に時間を飛ばしません。';
    }
  });

  root.prepend(heading);
  resize();
  render(0);
}

export { mountVisualSpike };
