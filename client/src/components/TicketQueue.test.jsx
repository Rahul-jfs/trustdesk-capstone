import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TicketQueue } from './TicketQueue.jsx';

const TICKETS = [
  { ticket_id: 'tkt_9001', subject: 'Damaged earbuds', channel: 'email', status: 'open' },
  { ticket_id: 'tkt_9002', subject: 'Tracking stalled', channel: 'chat', status: 'open' },
];

describe('TicketQueue', () => {
  afterEach(cleanup);

  it('lists every ticket with its ID and subject', () => {
    render(<TicketQueue tickets={TICKETS} selectedId={null} onSelect={() => {}} loading={false} />);

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('tkt_9001')).toBeTruthy();
    expect(screen.getByText('Tracking stalled')).toBeTruthy();
  });

  it('calls onSelect with the ticket ID when a row is clicked', () => {
    const onSelect = vi.fn();
    render(<TicketQueue tickets={TICKETS} selectedId={null} onSelect={onSelect} loading={false} />);

    fireEvent.click(screen.getByText('Tracking stalled'));

    expect(onSelect).toHaveBeenCalledWith('tkt_9002');
  });

  it('marks the selected row as pressed', () => {
    render(<TicketQueue tickets={TICKETS} selectedId="tkt_9002" onSelect={() => {}} loading={false} />);

    const selected = screen.getByText('Tracking stalled').closest('button');
    expect(selected.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows a loading message while tickets are loading', () => {
    render(<TicketQueue tickets={[]} selectedId={null} onSelect={() => {}} loading />);

    expect(screen.getByText('Loading tickets…')).toBeTruthy();
  });

  it('shows an empty state with the seed command when there are no tickets', () => {
    render(<TicketQueue tickets={[]} selectedId={null} onSelect={() => {}} loading={false} />);

    expect(screen.getByText('npm run seed')).toBeTruthy();
  });
});
