// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountVerticalSlice } from './vertical-slice';

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const noop = (): void => undefined;
  const gradient = { addColorStop: noop };
  const context = {
    canvas,
    save: noop, restore: noop, setTransform: noop, clearRect: noop, fillRect: noop,
    strokeRect: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, fill: noop, arc: noop, ellipse: noop, translate: noop, rotate: noop,
    fillText: noop, setLineDash: noop, measureText: () => ({ width: 0 }),
    createLinearGradient: () => gradient,
  } as unknown as CanvasRenderingContext2D;
  return context;
}

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function change(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
}

function input(element: HTMLInputElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
}

describe('R01画面から共通戦闘へ進む導線', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('名前なし開始を止め、出撃・停止再開・結果・1枚変更まで同じ画面導線で通す', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(
      this: HTMLCanvasElement,
    ) {
      return canvasContext(this);
    });
    let nextFrameId = 0;
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      nextFrameId += 1;
      return nextFrameId;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const root = document.createElement('main');
    document.body.append(root);
    mountVerticalSlice(root);

    const start = root.querySelector<HTMLButtonElement>('.home-start-button');
    const name = root.querySelector<HTMLInputElement>('.player-name-input');
    expect(start?.disabled).toBe(true);
    expect(root.querySelector('.editor-screen')).toBeNull();
    expect(name).not.toBeNull();
    if (!name || !start) throw new Error('ホームの開始部品がありません');
    click(start);
    expect(root.querySelector('.editor-screen')).toBeNull();

    input(name, 'テスト隊');
    expect(start.disabled).toBe(false);
    start.form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(root.querySelector('.editor-screen')).not.toBeNull();
    expect(root.textContent).toContain('敵へ向く');

    const sortie = [...root.querySelectorAll('button')].find((button) => button.textContent === '出撃する');
    expect(sortie).toBeDefined();
    click(sortie!);
    expect(root.querySelector('.battle-screen')).not.toBeNull();
    expect(root.textContent).toContain('今すること');
    expect(root.textContent).toContain('実行前:');

    const pause = root.querySelector<HTMLButtonElement>('.battle-pause-button');
    expect(pause).not.toBeNull();
    click(pause!);
    expect(root.querySelector<HTMLElement>('.pause-layer')?.hidden).toBe(false);
    expect(root.textContent).toContain('時間は進んでいません');
    click([...root.querySelectorAll('button')].find((button) => button.textContent === '再開')!);

    let now = performance.now();
    for (let index = 0; index < 12 && frames.length > 0; index += 1) {
      const callback = frames.shift();
      if (callback) callback(now += 100);
    }
    expect(root.textContent).toMatch(/刻み [1-9][0-9]?/);
    expect(root.textContent).toContain('実行中:');

    click(pause!);
    click([...root.querySelectorAll('button')].find((button) => button.textContent === 'リタイア')!);
    click([...root.querySelectorAll('button')].find((button) => button.textContent === 'リタイアする')!);
    await Promise.resolve();
    expect(root.querySelector('.result-screen')).not.toBeNull();
    expect(root.textContent).toContain('結果');

    const edit = [...root.querySelectorAll('button')].find((button) => button.textContent === '規則を直して再戦');
    expect(edit).toBeDefined();
    click(edit!);
    const actionSelect = root.querySelectorAll<HTMLSelectElement>('.rule-select')[1];
    expect(actionSelect).toBeDefined();
    change(actionSelect!, 'stop');
    expect(root.textContent).toContain('停止する');
    expect(root.querySelector('.program-compatibility')?.textContent).not.toContain('閲覧用');
  });
});
