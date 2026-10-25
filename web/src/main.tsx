import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/theme.css';
import './styles/app.css';
import './styles/controls.css';
import './styles/flow.css';
import './styles/modern.css';

createRoot(document.getElementById('root')!).render(<App />);
