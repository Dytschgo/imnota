import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL('./excalidraw/', document.baseURI).href });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
