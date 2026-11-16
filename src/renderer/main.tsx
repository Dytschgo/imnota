import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { loadNativeFaultProbe, NativeFaultProbe, nativeFaultReceiverPresent } from './app/native-fault-gate';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import './settings/settings-layout.css';

Object.assign(window, { EXCALIDRAW_ASSET_PATH: new URL('./excalidraw/', document.baseURI).href });

function renderApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary variant="app">
        <NativeFaultProbe scope="app" />
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}

// Only smoke fault-verification windows load the probe, before anything renders.
if (nativeFaultReceiverPresent) void loadNativeFaultProbe().then(renderApp);
else renderApp();
