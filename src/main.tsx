import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import DeployScreen from './DeployScreen.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Erc8183Test />
  </StrictMode>,
)
