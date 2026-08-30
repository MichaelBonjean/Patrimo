import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import { initSentry } from '@/lib/sentry'
import '@/index.css'

initSentry()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)