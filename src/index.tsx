import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

function mountExtension() {
  const rootEl = document.createElement('div');
  rootEl.id = 'looker-dashboard-summarization-root';
  document.body.appendChild(rootEl);
  const root = createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', mountExtension, { once: true });
} else {
  mountExtension();
}
