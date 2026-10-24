import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyPrefs } from './prefs';
import './style.css';

applyPrefs();

createRoot(document.getElementById('root')!).render(<App />);
