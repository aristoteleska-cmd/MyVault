import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { VaultProvider } from './state/vault';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <VaultProvider>
      <App />
    </VaultProvider>
  </StrictMode>,
);
