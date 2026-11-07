import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from './App.jsx';

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows ok when the API health check succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    render(<App />);

    expect(screen.getByRole('heading', { name: 'TrustDesk' })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('api-status').textContent).toBe('ok'));
  });

  it('shows unavailable when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('api-status').textContent).toBe('unavailable'),
    );
  });
});
