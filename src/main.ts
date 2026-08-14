import './styles.css';
import { mountVisualGallery } from './visual-gallery';
import { mountVisualSpike } from './visual-spike';
import { mountVerticalSlice } from './vertical-slice';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('アプリのルート要素が見つかりません');
}

const shell = document.createElement('main');
shell.className = 'spike-shell';
mountVerticalSlice(shell);
mountVisualSpike(shell);
mountVisualGallery(shell);
app.append(shell);
