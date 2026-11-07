import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createApi } from './api.js';
import { Workspace } from './Workspace.jsx';

const TICKETS = [
  { ticket_id: 'tkt_9001', customer_id: 'cus_1001', order_id: 'ord_5001', channel: 'email', subject: 'Damaged earbuds', created_at: '2026-06-28T10:15:00+05:30', status: 'open' },
  { ticket_id: 'tkt_9002', customer_id: 'cus_1002', order_id: 'ord_5002', channel: 'chat', subject: 'Tracking stalled', created_at: '2026-06-02T09:00:00+05:30', status: 'open' },
];

function detailFor(ticket) {
  return {
    ticket: { ...ticket, body: 'Body text.' },
    customer: { customer_id: ticket.customer_id, name: 'Customer', tier: 'gold', country: 'IN', verified: true, tags: [] },
    order: { order_id: ticket.order_id, status: 'delivered', eligible_return_until: null, payment_status: 'paid', tracking_number: 'T1', items: [] },
  };
}

function fakeFetch() {
  return vi.fn(async (url) => {
    const body = url === '/api/tickets' ? { tickets: TICKETS } : detailFor(TICKETS.find((t) => url.endsWith(t.ticket_id)));
    return { ok: true, status: 200, json: async () => body };
  });
}

describe('Workspace: approval fields when the ticket changes', () => {
  afterEach(cleanup);

  it('clears the reviewer ID and decision reason when another ticket is selected', async () => {
    render(<Workspace api={createApi({ token: 't', fetchImpl: fakeFetch() })} />);

    fireEvent.click(await screen.findByText('Damaged earbuds'));
    await screen.findByText('Body text.');
    fireEvent.change(screen.getByPlaceholderText('e.g. jane.reviewer'), { target: { value: 'jane.reviewer' } });
    fireEvent.change(screen.getByPlaceholderText('Required for approve or reject'), { target: { value: 'Photo confirms damage' } });

    fireEvent.click(screen.getByText('Tracking stalled'));

    await waitFor(() => expect(screen.getByPlaceholderText('e.g. jane.reviewer').value).toBe(''));
    expect(screen.getByPlaceholderText('Required for approve or reject').value).toBe('');
  });
});
