import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('アプリのルート要素が見つかりません');
}

const shell = document.createElement('main');
shell.className = 'shell';

const eyebrow = document.createElement('p');
eyebrow.className = 'eyebrow';
eyebrow.textContent = 'P0-02 / BUILD SCAFFOLD';

const title = document.createElement('h1');
title.textContent = 'ロボボン';

const message = document.createElement('p');
message.className = 'message';
message.textContent = '命令を組む。自動戦闘を観察する。原因を読み、組み直す。';

const status = document.createElement('p');
status.className = 'status';
status.textContent = '実装土台を確認中 — ゲーム機能は次の節目で追加します。';

shell.append(eyebrow, title, message, status);
app.append(shell);
