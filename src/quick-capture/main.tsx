import { createRoot } from 'react-dom/client';
import { QuickCaptures } from './QuickCaptures';
import '../renderer/styles.css';
import './style.css';

createRoot(document.getElementById('root')!).render(<QuickCaptures />);
