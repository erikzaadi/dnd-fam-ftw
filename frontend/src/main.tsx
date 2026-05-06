import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__resetTutorial = () => {
    localStorage.setItem('onboarding_tutorial_step', '1');
    console.log('[debug] tutorial reset to step 1 - refresh the session page');
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
