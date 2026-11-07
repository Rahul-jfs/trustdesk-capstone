import { toolLabel } from '../labels.js';
const PERCENT_METRICS = [
  ['triage_accuracy', 'Triage accuracy (category and priority)'],
  ['citation_coverage', 'Citation coverage'],
  ['unsafe_action_block_rate', 'Unsafe action block rate'],
  ['allowed_action_recall', 'Allowed action recall'],
  ['escalation_accuracy', 'Escalation accuracy'],
];

const fmt = (value) => (value === null || value === undefined ? 'n/a' : `${Math.round(value * 1000) / 10}%`);

/** Eval tab: starts a background run and shows its summary and per-case table. */
export function EvalPanel({ run, busy, error, onStart }) {
  const summary = run?.summary;
  return (
    <section aria-label="Evaluation" className="panel eval">
      <div className="panel-head">
        <h2>Evaluation</h2>
        <button type="button" onClick={onStart} disabled={busy || run?.status === 'running'}>
          Run eval suite
        </button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {!run && <p className="muted">No run yet. The suite runs all eight demo cases in the background.</p>}
      {run?.status === 'running' && <p>Running… (provider: {run.provider})</p>}
      {run?.status === 'failed' && <p role="alert" className="error">Run failed: {run.error}</p>}

      {summary && (
        <>
          <p>
            {summary.passed_cases} of {summary.total_cases} cases passed
            {summary.errored_cases > 0 ? `, ${summary.errored_cases} errored` : ''}.
            {' '}Adversarial cases safe: <strong>{summary.all_adversarial_safe ? 'yes' : 'no'}</strong>
          </p>
          <table>
            <tbody>
              {PERCENT_METRICS.map(([key, label]) => (
                <tr key={key}>
                  <th scope="row">{label}</th>
                  <td>{fmt(summary[key])}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Answer requirements passed</th>
                <td>{fmt(summary.answer_requirement_coverage.rate)} ({summary.answer_requirement_coverage.unchecked} unchecked)</td>
              </tr>
            </tbody>
          </table>

          <table className="case-table">
            <thead>
              <tr>
                <th>Eval case</th><th>Ticket</th><th>Result</th><th>Category</th><th>Priority</th>
                <th>Citations</th><th>Escalation</th><th>Disallowed action proposed</th><th>Adversarial check</th>
              </tr>
            </thead>
            <tbody>
              {run.cases.map((c) => (
                <tr key={c.case_id} className={c.passed ? '' : 'failed-row'}>
                  <td>{c.case_id}</td>
                  <td>{c.ticket_id}</td>
                  <td>{c.error ? `error: ${c.error.toLowerCase().replace(/_/g, ' ')}` : c.passed ? 'pass' : 'fail'}</td>
                  <td>{yesNo(c.category_ok)}</td>
                  <td>{yesNo(c.priority_ok)}</td>
                  <td>{yesNo(c.citation_ok)}</td>
                  <td>{yesNo(c.escalation_ok)}</td>
                  <td>{c.disallowed_recommended?.map(toolLabel).join(', ') || 'none'}</td>
                  <td>{c.adversarial ? (c.adversarial.safe ? 'Safe' : 'Unsafe') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

const yesNo = (value) => (value === undefined ? '—' : value ? 'yes' : 'no');
