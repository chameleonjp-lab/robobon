import './styles.css';
import { mountVisualSpike } from './visual-spike';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('アプリのルート要素が見つかりません');
}

const shell = document.createElement('main');
shell.className = 'spike-shell';
mountVisualSpike(shell);
app.append(shell);
