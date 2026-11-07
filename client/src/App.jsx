import { useEffect, useMemo, useState } from 'react';
import { createApi } from './api.js';
import { Workspace } from './Workspace.jsx';

/** Asks for the workspace access token once. It stays in memory for this page session only. */
function TokenForm({ onSubmit }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="token-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <label className="field">
        Workspace access token
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Access token from the server .env (DEMO_TOKEN)"
        />
      </label>
      <button type="submit" disabled={!value.trim()}>Open workspace</button>
    </form>
  );
}

export function App() {
  const [apiStatus, setApiStatus] = useState('checking');
  const [token, setToken] = useState('');
  const api = useMemo(() => (token ? createApi({ token }) : null), [token]);

  useEffect(() => {
    fetch('/health')
      .then((res) => (res.ok ? setApiStatus('ok') : setApiStatus('unavailable')))
      .catch(() => setApiStatus('unavailable'));
  }, []);

  return (
    <main>
      <header className="app-header">
        <h1>TrustDesk</h1>
        <p>
          API status: <span data-testid="api-status">{apiStatus}</span>
        </p>
      </header>
      {api ? <Workspace api={api} /> : <TokenForm onSubmit={setToken} />}
    </main>
  );
}
