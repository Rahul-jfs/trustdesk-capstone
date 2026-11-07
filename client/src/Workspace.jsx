import { ruleLabel } from './labels.js';
import { useEffect, useState } from 'react';
import { ApiError } from './api.js';
import { ApprovalPanel } from './components/ApprovalPanel.jsx';
import { EvalPanel } from './components/EvalPanel.jsx';
import { TicketDetail } from './components/TicketDetail.jsx';
import { TicketQueue } from './components/TicketQueue.jsx';
import { DraftPanel, TracePanel, TriagePanel } from './components/Panels.jsx';

const EVAL_POLL_MS = 1000;

/** Renders an API error, including policy reasons when the server sent them. */
function describeError(err) {
  if (!(err instanceof ApiError)) return 'Something went wrong.';
  const reasons = Array.isArray(err.details) ? err.details.map((r) => ruleLabel(r.rule)).join(', ') : '';
  return reasons ? `${err.message} (${reasons})` : err.message;
}

/**
 * The support-agent workspace. This container owns the API calls and the in-memory state for the
 * selected ticket. The panels only render what they are given.
 *
 * @param {{ api: ReturnType<import('./api.js').createApi> }} props
 */
export function Workspace({ api }) {
  const [tab, setTab] = useState('queue');
  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [triageById, setTriageById] = useState({});
  const [draftById, setDraftById] = useState({});
  const [actionsById, setActionsById] = useState({});
  const [trace, setTrace] = useState(null);
  const [reviewerId, setReviewerId] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busyActionId, setBusyActionId] = useState(null);
  const [requestingTool, setRequestingTool] = useState(null);
  const [evalRun, setEvalRun] = useState(null);
  const [evalError, setEvalError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/tickets')
      .then((data) => !cancelled && setTickets(data.tickets))
      .catch((err) => !cancelled && setError(describeError(err)))
      .finally(() => !cancelled && setLoadingTickets(false));
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Poll a running eval until the server stores the result. The run itself is in the background.
  useEffect(() => {
    if (!evalRun || evalRun.status !== 'running') return undefined;
    const timer = setInterval(() => {
      api
        .get(`/api/eval-runs/${evalRun.eval_run_id}`)
        .then((run) => setEvalRun(run))
        .catch((err) => setEvalError(describeError(err)));
    }, EVAL_POLL_MS);
    return () => clearInterval(timer);
  }, [api, evalRun]);

  async function selectTicket(ticketId) {
    // The reviewer ID and reason belong to one decision on one ticket, so they clear when the agent changes ticket.
    setReviewerId('');
    setSelectedId(ticketId);
    setDetail(null);
    setTrace(null);
    setError(null);
    try {
      setDetail(await api.get(`/api/tickets/${ticketId}`));
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function loadTrace(runId) {
    try {
      setTrace(await api.get(`/api/agent-runs/${runId}`));
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function runTriage() {
    setBusy('triage');
    setError(null);
    try {
      const triage = await api.post(`/api/tickets/${selectedId}/triage`);
      setTriageById((prev) => ({ ...prev, [selectedId]: triage }));
      await loadTrace(triage.run_id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function runDraft() {
    setBusy('draft');
    setError(null);
    try {
      const draft = await api.post(`/api/tickets/${selectedId}/draft-reply`);
      setDraftById((prev) => ({ ...prev, [selectedId]: draft }));
      await loadTrace(draft.run_id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  /** Puts an action in the list for its ticket, replacing an earlier copy with the same ID. */
  function upsertAction(action) {
    setActionsById((prev) => {
      const current = prev[action.ticket_id] ?? [];
      const others = current.filter((a) => a.action_id !== action.action_id);
      return { ...prev, [action.ticket_id]: [action, ...others] };
    });
  }

  async function requestAction(recommendation) {
    const ticketId = selectedId;
    setRequestingTool(recommendation.tool_name);
    setActionError(null);
    try {
      const action = await api.post('/api/tool-actions', {
        ticket_id: ticketId,
        tool_name: recommendation.tool_name,
        payload: { ...recommendation.payload, idempotency_key: `${ticketId}-${recommendation.tool_name}-1` },
      });
      upsertAction(action);
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setRequestingTool(null);
    }
  }

  async function decide(actionId, decision, reason) {
    setBusyActionId(actionId);
    setActionError(null);
    try {
      upsertAction(await api.post(`/api/tool-actions/${actionId}/approve`, { reviewer_id: reviewerId.trim(), decision, reason }));
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusyActionId(null);
    }
  }

  async function execute(actionId) {
    setBusyActionId(actionId);
    setActionError(null);
    try {
      const result = await api.post(`/api/tool-actions/${actionId}/execute`);
      upsertAction(result);
    } catch (err) {
      setActionError(describeError(err));
      // A failed execute leaves the action in a new state on the server, so read it back.
      try {
        upsertAction(await api.get(`/api/tool-actions/${actionId}`));
      } catch {
        // Keep the error message; the list still shows the last known state.
      }
    } finally {
      setBusyActionId(null);
    }
  }

  async function startEval() {
    setEvalError(null);
    try {
      const started = await api.post('/api/eval-runs');
      setEvalRun({ eval_run_id: started.eval_run_id, status: 'running', provider: '…' });
    } catch (err) {
      setEvalError(describeError(err));
    }
  }

  const triage = triageById[selectedId] ?? null;
  const draft = draftById[selectedId] ?? null;
  const actions = actionsById[selectedId] ?? [];

  return (
    <div className="workspace">
      <nav className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'queue'} onClick={() => setTab('queue')}>Ticket queue</button>
        <button type="button" role="tab" aria-selected={tab === 'eval'} onClick={() => setTab('eval')}>Evaluation</button>
      </nav>

      {error && <p role="alert" className="error">{error}</p>}

      {tab === 'queue' ? (
        <div className="columns">
          <div className="col-left">
            <TicketQueue tickets={tickets} selectedId={selectedId} onSelect={selectTicket} loading={loadingTickets} />
          </div>
          <div className="col-centre">
            <TicketDetail detail={detail} />
          </div>
          <div className="col-right">
            <TriagePanel triage={triage} busy={busy === 'triage'} onRun={runTriage} />
            <DraftPanel
              draft={draft}
              busy={busy === 'draft'}
              canDraft={Boolean(selectedId && triage)}
              onRun={runDraft}
              onRequestAction={requestAction}
              requestingTool={requestingTool}
            />
            <ApprovalPanel
              key={selectedId ?? 'none'}
              actions={actions}
              reviewerId={reviewerId}
              onReviewerChange={setReviewerId}
              onDecide={decide}
              onExecute={execute}
              busyActionId={busyActionId}
              error={actionError}
            />
            <TracePanel trace={trace} />
          </div>
        </div>
      ) : (
        <EvalPanel run={evalRun} busy={false} error={evalError} onStart={startEval} />
      )}
    </div>
  );
}
