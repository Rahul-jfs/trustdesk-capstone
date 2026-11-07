import { actionStatusLabel, checkLabel, ruleLabel, runStatusLabel, runTypeLabel, toolLabel, yesNo } from '../labels.js';
/**
 * Right-column panels: triage, draft, trace, and the guardrail flag banner.
 * Presentational only. The workspace container owns the API calls.
 */

export function GuardrailFlags({ flags }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div role="alert" className="flag-banner">
      <strong>Unsafe instructions detected in the customer message.</strong>
      <span> Flags: {flags.join(', ')}. The ticket is restricted and escalated; sensitive actions are blocked.</span>
    </div>
  );
}

export function TriagePanel({ triage, busy, onRun }) {
  return (
    <section aria-label="Triage" className="panel">
      <div className="panel-head">
        <h3>Triage</h3>
        <button type="button" onClick={onRun} disabled={busy}>Run triage</button>
      </div>
      {triage ? (
        <dl>
          <dt>Category</dt><dd>{triage.category}</dd>
          <dt>Priority</dt><dd>{triage.priority}</dd>
          <dt>Sentiment</dt><dd>{triage.sentiment}</dd>
          <dt>Escalate to human</dt><dd>{yesNo(triage.should_escalate)}</dd>
          <dt>Summary</dt><dd>{triage.reason_summary}</dd>
        </dl>
      ) : (
        <p className="muted">Not run yet.</p>
      )}
    </section>
  );
}

export function DraftPanel({ draft, busy, canDraft, onRun, onRequestAction, requestingTool }) {
  return (
    <section aria-label="Draft reply" className="panel">
      <div className="panel-head">
        <h3>Draft reply</h3>
        <button type="button" onClick={onRun} disabled={busy || !canDraft}>Draft reply</button>
      </div>
      {!canDraft && <p className="muted">Run triage first.</p>}
      {draft && (
        <>
          <GuardrailFlags flags={draft.flags} />
          <p className="draft-body">{draft.body}</p>
          <p>
            Citations:{' '}
            {draft.citations.length === 0 ? <span className="muted">none (escalated)</span> : draft.citations.join(', ')}
          </p>
          <p>Escalate to human: {yesNo(draft.should_escalate)}</p>
          {draft.recommended_actions.length > 0 && (
            <div>
              <h4>Recommended actions</h4>
              <ul>
                {draft.recommended_actions.map((action) => (
                  <li key={action.tool_name}>
                    <span>{toolLabel(action.tool_name)}</span>{' '}
                    <span className="muted">{action.requires_human_approval ? '(needs approval)' : '(no approval step)'}</span>
                    <p className="muted">{action.reason}</p>
                    <button
                      type="button"
                      onClick={() => onRequestAction(action)}
                      disabled={requestingTool === action.tool_name}
                    >
                      Request action
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function TracePanel({ trace }) {
  return (
    <section aria-label="Trace" className="panel">
      <h3>Trace</h3>
      {!trace ? (
        <p className="muted">Run triage or a draft to see its trace.</p>
      ) : (
        <>
          <p>
            {runTypeLabel(trace.run_type)} · <strong>{runStatusLabel(trace.status)}</strong> · <code>{trace.run_id}</code>
          </p>
          <p>Retrieved: {trace.retrieved_doc_ids.length === 0 ? 'none' : trace.retrieved_doc_ids.join(', ')}</p>
          <ul className="trace-list">
            {trace.guardrail_results.map((g, i) => (
              <li key={i}>
                <span>{checkLabel(g.check)}</span>
                {g.result ? `: ${g.result}` : ''}
                {g.flags?.length ? ` (${g.flags.join(', ')})` : ''}
                {g.rules?.length ? ` [${g.rules.map(ruleLabel).join(', ')}]` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
