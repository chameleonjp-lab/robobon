import './styles.css';
import { mountVerticalSlice } from './vertical-slice';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('アプリのルート要素が見つかりません');
}

const shell = document.createElement('main');
shell.className = 'app-shell';
mountVerticalSlice(shell);
app.append(shell);
