import { actionStatusLabel, toolLabel } from '../labels.js';
import { useState } from 'react';

/**
 * Tool actions for the selected ticket. Approve and Reject need a reviewer ID and a reason.
 * Execute is offered only once an action is approved (or runs without approval, when the tool allows it).
 */
export function ApprovalPanel({ actions, reviewerId, onReviewerChange, onDecide, onExecute, busyActionId, error }) {
  const [reason, setReason] = useState('');
  const canDecide = reviewerId.trim() !== '' && reason.trim() !== '';

  return (
    <section aria-label="Approvals" className="panel">
      <h3>Approval</h3>
      <label className="field">
        Reviewer ID
        <input
          value={reviewerId}
          onChange={(e) => onReviewerChange(e.target.value)}
          placeholder="e.g. jane.reviewer"
        />
      </label>
      <label className="field">
        Decision reason
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required for approve or reject" />
      </label>
      {error && <p role="alert" className="error">{error}</p>}

      {actions.length === 0 ? (
        <p className="muted">No tool actions yet. Request one from a draft.</p>
      ) : (
        <ul className="actions">
          {actions.map((action) => (
            <li key={action.action_id} className="action">
              <div>
                <strong>{toolLabel(action.tool_name)}</strong> <span className="status">{actionStatusLabel(action.status)}</span>
              </div>
              <div className="muted">Idempotency key: {action.idempotency_key}</div>
              {action.reference_id && <div>Reference: <code>{action.reference_id}</code></div>}
              {action.failure_reason !== null && action.status === 'failed' && (
                <div className="error">Downstream failed. You can retry.</div>
              )}

              <div className="action-buttons">
                {action.status === 'approval_required' && (
                  <>
                    <button
                      type="button"
                      disabled={!canDecide || busyActionId === action.action_id}
                      onClick={() => onDecide(action.action_id, 'approved', reason.trim())}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={!canDecide || busyActionId === action.action_id}
                      onClick={() => onDecide(action.action_id, 'rejected', reason.trim())}
                    >
                      Reject
                    </button>
                  </>
                )}
                {(action.status === 'approved' || action.status === 'requested' || action.status === 'failed') && (
                  <button
                    type="button"
                    disabled={busyActionId === action.action_id}
                    onClick={() => onExecute(action.action_id)}
                  >
                    {action.status === 'failed' ? 'Retry execute' : 'Execute'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
