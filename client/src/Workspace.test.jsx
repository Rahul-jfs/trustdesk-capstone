import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createApi } from './api.js';
import { Workspace } from './Workspace.jsx';

const TICKET = {
  ticket_id: 'tkt_9001',
  customer_id: 'cus_1001',
  order_id: 'ord_5001',
  channel: 'email',
  subject: 'Damaged earbuds',
  created_at: '2026-06-28T10:15:00+05:30',
  status: 'open',
};

const DETAIL = {
  ticket: { ...TICKET, body: 'Arrived cracked.' },
  customer: { customer_id: 'cus_1001', name: 'Asha Rao', tier: 'gold', country: 'IN', verified: true, tags: [] },
  order: {
    order_id: 'ord_5001',
    status: 'delivered',
    eligible_return_until: '2026-07-01',
    payment_status: 'paid',
    tracking_number: 'BLUETRK10001',
    items: [{ sku: 'BG-AIRPODS-01', name: 'BlueBuds Air', category: 'audio', final_sale: false }],
  },
};

const TRIAGE = {
  ticket_id: 'tkt_9001',
  category: 'refund',
  priority: 'medium',
  sentiment: 'frustrated',
  should_escalate: false,
  reason_summary: 'Damaged item within the return window.',
  run_id: 'run_triage',
  status: 'completed',
};

const DRAFT = {
  draft_id: 'draft_1',
  ticket_id: 'tkt_9001',
  status: 'generated',
  body: 'Sorry the earbuds arrived damaged.',
  citations: ['KB-REFUND-001'],
  recommended_actions: [
    {
      tool_name: 'create_replacement_order',
      requires_human_approval: true,
      reason: 'Damaged on arrival.',
      payload: { order_id: 'ord_5001', sku: 'BG-AIRPODS-01', reason: 'Damaged on arrival.' },
    },
  ],
  should_escalate: false,
  flags: [],
  run_id: 'run_draft',
};

function actionView(status, extra = {}) {
  return {
    action_id: 'act_1',
    ticket_id: 'tkt_9001',
    tool_name: 'create_replacement_order',
    status,
    idempotency_key: 'tkt_9001-create_replacement_order-1',
    reference_id: null,
    failure_reason: null,
    ...extra,
  };
}

const TRACE = { run_id: 'run_triage', run_type: 'triage', status: 'completed', ticket_id: 'tkt_9001', retrieved_doc_ids: ['KB-REFUND-001'], guardrail_results: [] };

/**
 * A fake fetch that answers by "METHOD path". Each route can be a value or a function of the request body.
 * Unknown routes fail the test, so every call the UI makes is accounted for.
 */
function fakeFetch(routes) {
  return vi.fn(async (url, options = {}) => {
    const key = `${options.method ?? 'GET'} ${url}`;
    if (!(key in routes)) throw new Error(`Unexpected request: ${key}`);
    const route = routes[key];
    const body = typeof route === 'function' ? route(options.body ? JSON.parse(options.body) : undefined) : route;
    const status = body?.__status ?? 200;
    const payload = body?.__status ? body.body : body;
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  });
}

function baseRoutes(extra = {}) {
  return {
    'GET /api/tickets': { tickets: [TICKET] },
    'GET /api/tickets/tkt_9001': DETAIL,
    'POST /api/tickets/tkt_9001/triage': TRIAGE,
    'POST /api/tickets/tkt_9001/draft-reply': DRAFT,
    'GET /api/agent-runs/run_triage': TRACE,
    'GET /api/agent-runs/run_draft': { ...TRACE, run_id: 'run_draft', run_type: 'draft_reply' },
    ...extra,
  };
}

function renderWorkspace(routes) {
  const fetchImpl = fakeFetch(routes);
  render(<Workspace api={createApi({ token: 't', fetchImpl })} />);
  return fetchImpl;
}

describe('Workspace', () => {
  afterEach(cleanup);

  it('loads the queue, shows the selected ticket, and runs triage then a draft', async () => {
    renderWorkspace(baseRoutes());

    fireEvent.click(await screen.findByText('Damaged earbuds'));
    expect(await screen.findByText('Asha Rao')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Run triage' }));
    expect(await screen.findByText('Damaged item within the return window.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Draft reply' }));
    expect(await screen.findByText('Sorry the earbuds arrived damaged.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Draft reply' })).getByText(/KB-REFUND-001/)).toBeTruthy();
  });

  it('never renders the customer email address', async () => {
    renderWorkspace({ ...baseRoutes(), 'GET /api/tickets/tkt_9001': { ...DETAIL, customer: { ...DETAIL.customer, email: 'asha@example.com' } } });

    fireEvent.click(await screen.findByText('Damaged earbuds'));
    await screen.findByText('Asha Rao');

    expect(screen.queryByText(/asha@example.com/)).toBeNull();
  });

  it('requests a recommended action, approves it, and executes it once', async () => {
    let status = 'approval_required';
    const routes = baseRoutes({
      'POST /api/tool-actions': () => actionView('approval_required'),
      'POST /api/tool-actions/act_1/approve': () => {
        status = 'approved';
        return actionView('approved', { approvals: [{ decision: 'approved' }] });
      },
      'POST /api/tool-actions/act_1/execute': () => {
        status = 'executed';
        return actionView('executed', { reference_id: 'ref_77' });
      },
    });
    const fetchImpl = renderWorkspace(routes);

    fireEvent.click(await screen.findByText('Damaged earbuds'));
    await screen.findByText('Asha Rao');
    fireEvent.click(screen.getByRole('button', { name: 'Run triage' }));
    await screen.findByText('Damaged item within the return window.');
    fireEvent.click(screen.getByRole('button', { name: 'Draft reply' }));
    await screen.findByText('Sorry the earbuds arrived damaged.');

    fireEvent.click(screen.getByRole('button', { name: 'Request action' }));
    const approvals = screen.getByRole('region', { name: 'Approvals' });
    expect(await within(approvals).findByText('Waiting for approval')).toBeTruthy();

    // The request uses a stable key per ticket and tool, and the stored payload.
    const requestCall = fetchImpl.mock.calls.find(([url, opts]) => url === '/api/tool-actions' && opts.method === 'POST');
    expect(JSON.parse(requestCall[1].body)).toMatchObject({
      ticket_id: 'tkt_9001',
      tool_name: 'create_replacement_order',
      payload: { idempotency_key: 'tkt_9001-create_replacement_order-1', sku: 'BG-AIRPODS-01' },
    });

    fireEvent.change(screen.getByPlaceholderText('e.g. jane.reviewer'), { target: { value: 'jane.reviewer' } });
    fireEvent.change(screen.getByPlaceholderText('Required for approve or reject'), { target: { value: 'Photo confirms damage' } });
    fireEvent.click(within(approvals).getByRole('button', { name: 'Approve' }));
    await within(approvals).findByRole('button', { name: 'Execute' });

    fireEvent.click(within(approvals).getByRole('button', { name: 'Execute' }));
    expect(await within(approvals).findByText('ref_77')).toBeTruthy();
    expect(status).toBe('executed');

    const approveCall = fetchImpl.mock.calls.find(([url]) => url.endsWith('/approve'));
    expect(JSON.parse(approveCall[1].body)).toEqual({ reviewer_id: 'jane.reviewer', decision: 'approved', reason: 'Photo confirms damage' });
  });

  it('shows the policy reasons when the server blocks a requested action', async () => {
    const routes = baseRoutes({
      'POST /api/tool-actions': () => ({
        __status: 422,
        body: { error: { code: 'POLICY_BLOCKED', message: 'The policy engine blocked this action', details: [{ rule: 'sku_not_on_order' }] } },
      }),
    });
    renderWorkspace(routes);

    fireEvent.click(await screen.findByText('Damaged earbuds'));
    await screen.findByText('Asha Rao');
    fireEvent.click(screen.getByRole('button', { name: 'Run triage' }));
    await screen.findByText('Damaged item within the return window.');
    fireEvent.click(screen.getByRole('button', { name: 'Draft reply' }));
    await screen.findByText('Sorry the earbuds arrived damaged.');
    fireEvent.click(screen.getByRole('button', { name: 'Request action' }));

    expect(await screen.findByText(/Item not on the order/)).toBeTruthy();
  });

  it('starts an eval run and shows the summary once it completes', async () => {
    const summary = {
      total_cases: 8, scored_cases: 8, errored_cases: 0, passed_cases: 7,
      triage_accuracy: 1, citation_coverage: 0.875, unsafe_action_block_rate: 1, allowed_action_recall: 0.857,
      escalation_accuracy: 1, answer_requirement_coverage: { pass: 20, fail: 0, unchecked: 2, rate: 1 },
      all_adversarial_safe: true, adversarial: {},
    };
    const routes = baseRoutes({
      'POST /api/eval-runs': { eval_run_id: 'eval_run_1', status: 'running' },
      'GET /api/eval-runs/eval_run_1': { eval_run_id: 'eval_run_1', status: 'completed', provider: 'mock', summary, cases: [] },
    });
    renderWorkspace(routes);

    fireEvent.click(await screen.findByRole('tab', { name: 'Evaluation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run eval suite' }));

    expect(await screen.findByText(/7 of 8 cases passed/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/Adversarial cases safe/).textContent).toContain('yes');
  });
});

