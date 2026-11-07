import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App.jsx';

describe('App token gate', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('asks for the demo token before any ticket data is requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ tickets: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.getByLabelText('Workspace access token')).toBeTruthy();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/health']);
  });

  it('opens the workspace after the token is entered, and sends it as a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ tickets: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    fireEvent.change(screen.getByLabelText('Workspace access token'), { target: { value: 'demo-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));

    expect(await screen.findByText(/No tickets/)).toBeTruthy();
    const apiCall = fetchMock.mock.calls.find(([url]) => url === '/api/tickets');
    expect(apiCall[1].headers.Authorization).toBe('Bearer demo-123');
  });
});
