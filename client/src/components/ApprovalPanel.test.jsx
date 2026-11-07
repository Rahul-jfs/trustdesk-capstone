import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApprovalPanel } from './ApprovalPanel.jsx';

function action(overrides = {}) {
  return {
    action_id: 'act_1',
    ticket_id: 'tkt_9001',
    tool_name: 'create_replacement_order',
    status: 'approval_required',
    idempotency_key: 'tkt_9001-create_replacement_order-1',
    reference_id: null,
    failure_reason: null,
    ...overrides,
  };
}

function renderPanel(props = {}) {
  const handlers = { onReviewerChange: vi.fn(), onDecide: vi.fn(), onExecute: vi.fn() };
  render(
    <ApprovalPanel
      actions={props.actions ?? [action()]}
      reviewerId={props.reviewerId ?? ''}
      busyActionId={null}
      error={props.error ?? null}
      {...handlers}
    />,
  );
  return handlers;
}

describe('ApprovalPanel', () => {
  afterEach(cleanup);

  it('disables Approve and Reject until a reviewer ID and a reason are given', () => {
    renderPanel({ reviewerId: '' });

    expect(screen.getByRole('button', { name: 'Approve' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Reject' }).disabled).toBe(true);
  });

  it('approves with the reviewer ID and the typed reason', () => {
    const { onDecide } = renderPanel({ reviewerId: 'jane.reviewer' });

    fireEvent.change(screen.getByPlaceholderText('Required for approve or reject'), { target: { value: 'Photo confirms damage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onDecide).toHaveBeenCalledWith('act_1', 'approved', 'Photo confirms damage');
  });

  it('rejects with decision rejected', () => {
    const { onDecide } = renderPanel({ reviewerId: 'jane.reviewer' });

    fireEvent.change(screen.getByPlaceholderText('Required for approve or reject'), { target: { value: 'Not eligible' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(onDecide).toHaveBeenCalledWith('act_1', 'rejected', 'Not eligible');
  });

  it('offers Execute only once the action is approved, not before', () => {
    renderPanel({ actions: [action({ status: 'approval_required' })] });
    expect(screen.queryByRole('button', { name: 'Execute' })).toBeNull();
  });

  it('offers Execute for an approved action and calls onExecute', () => {
    const { onExecute } = renderPanel({ actions: [action({ status: 'approved' })] });

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));

    expect(onExecute).toHaveBeenCalledWith('act_1');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('shows the reference once executed, and no action buttons', () => {
    renderPanel({ actions: [action({ status: 'executed', reference_id: 'ref_42' })] });

    expect(screen.getByText('ref_42')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Execute' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('offers a retry for a failed action', () => {
    renderPanel({ actions: [action({ status: 'failed', failure_reason: 'downstream' })] });

    expect(screen.getByRole('button', { name: 'Retry execute' })).toBeTruthy();
  });

  it('shows the API error message when an action call fails', () => {
    renderPanel({ error: 'Action is rejected; only approval_required actions can be decided' });

    expect(screen.getByRole('alert').textContent).toContain('only approval_required');
  });
});
