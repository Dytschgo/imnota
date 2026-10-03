import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import './settings/settings-layout.css';

Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL('./excalidraw/', document.baseURI).href });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary variant="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
