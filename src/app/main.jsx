import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MobileApp from './MobileApp.jsx';

createRoot(document.getElementById('root')).render(<StrictMode><MobileApp /></StrictMode>);
