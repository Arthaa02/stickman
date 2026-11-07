import './style.css';
import { AppController } from './ui/AppController';

const appRoot = document.querySelector<HTMLElement>('#app');
if (!appRoot) {
  throw new Error('Root #app element not found');
}

new AppController(appRoot);

