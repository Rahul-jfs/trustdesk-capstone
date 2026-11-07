/**
 * Left column: the ticket queue. Selecting a row loads its detail in the centre column.
 */
export function TicketQueue({ tickets, selectedId, onSelect, loading }) {
  if (loading) {
    return <section aria-label="Ticket queue"><p>Loading tickets…</p></section>;
  }
  if (tickets.length === 0) {
    return <section aria-label="Ticket queue"><p>No tickets. Run <code>npm run seed</code> to load the demo data.</p></section>;
  }

  return (
    <section aria-label="Ticket queue">
      <h2>Ticket queue</h2>
      <ul className="queue">
        {tickets.map((ticket) => {
          const selected = ticket.ticket_id === selectedId;
          return (
            <li key={ticket.ticket_id}>
              <button
                type="button"
                className={selected ? 'queue-item selected' : 'queue-item'}
                aria-pressed={selected}
                onClick={() => onSelect(ticket.ticket_id)}
              >
                <span className="queue-id">{ticket.ticket_id}</span>
                <span className="queue-subject">{ticket.subject}</span>
                <span className="queue-meta">{ticket.channel} · {ticket.status}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
