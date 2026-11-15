import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// Fontlar src/index.css içindeki @font-face tanımlarıyla yerelden yüklenir.

// BrowserRouter (HashRouter DEĞİL) — hem `server.js`'in prod dalı hem de
// firebase.json'daki `"source": "**" → /index.html` rewrite'ı SPA fallback
// yaptığından temiz path'ler doğrudan yüklenebilir.
//
// Router App'in DIŞINDA/ÜSTÜNDEDİR (App'in içindeki authenticated ağaçta
// değil): kullanıcı giriş yapmamışken de URL anlamlı kalmalı. `/tasks/abc123`
// linkine tıklayan oturumsuz bir kullanıcı Login ekranını görür, giriş
// yaptıktan sonra AuthenticatedApp aynı URL üzerinde monte olur ve doğrudan o
// talimatın detayı açılır — Router yalnızca AuthenticatedApp içinde kurulsaydı
// derin link giriş sırasında kaybolurdu (bkz. kod denetimi P1-6). Ayrıca
// App.tsx'in giriş-öncesi shell'indeki toast tıklaması da navigate() çağırır.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

