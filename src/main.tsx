import { createRoot } from 'react-dom/client';
import App from './App';
import { AppController } from './controller';
import './styles.css';
import './explore-motion.css';
import './dark-mode.css';

const controller = new AppController();
createRoot(document.getElementById('root')!).render(<App controller={controller}/>);
void controller.start();
if (import.meta.hot) import.meta.hot.dispose(() => controller.dispose());
