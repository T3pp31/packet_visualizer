import { createApp } from './app';
import './styles/main.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('#app element not found');
}

void createApp(root);
