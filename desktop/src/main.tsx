import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './ui/App';
import { Login } from './pages/login';
import { getToken, setSession } from './services/apiClient';
import './styles.css';

function Root() {
  const [token, setToken] = useState<string | null>(getToken());

  if (!token) {
    return (
      <Login
        onLoginSuccess={(newToken: string, user: unknown) => {
          setSession(newToken, user);
          setToken(newToken);
        }}
      />
    );
  }

  return (
    <App
      onLogout={() => {
        setSession(null, null);
        setToken(null);
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
