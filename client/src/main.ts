import './ui/styles.css';
import { App } from './app/App';

const app = new App();
(window as unknown as { app: App }).app = app;
void app.start();

if (import.meta.env.DEV) {
  void import('./app/devshot').then((m) => {
    (window as any).shot = (name: string) => m.devShot(name, () => app.renderer.render(0));
  });
}
