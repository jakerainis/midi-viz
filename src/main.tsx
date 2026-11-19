import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import { App } from './ui/App';
import { restore, startAutosave } from './state/persist';
import { connectEngine, loadInitialKit } from './audio/bridge';
import { loadLibrary } from './state/riffs';

import { engine } from './audio/engine';
import { useApp } from './state/store';

// Handles for poking at the app from the browser console while developing.
if (import.meta.env.DEV) Object.assign(window, { __midiviz: { engine, useApp } });

const root = createRoot(document.getElementById('root')!);

async function boot() {
  void loadLibrary();
  await restore();
  connectEngine();
  startAutosave();
  void loadInitialKit();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
