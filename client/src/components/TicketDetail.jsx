/**
 * Centre column: the selected ticket with its customer and order context. Contact details are not shown.
 */
export function TicketDetail({ detail }) {
  if (!detail) {
    return <section aria-label="Ticket detail"><p>Select a ticket from the queue.</p></section>;
  }
  const { ticket, customer, order } = detail;

  return (
    <section aria-label="Ticket detail">
      <h2>{ticket.subject}</h2>
      <p className="meta">{ticket.ticket_id} · {ticket.channel} · created {ticket.created_at}</p>
      <blockquote className="ticket-body">{ticket.body}</blockquote>

      <div className="context-grid">
        <div>
          <h3>Customer</h3>
          <dl>
            <dt>Name</dt><dd>{customer.name}</dd>
            <dt>Tier</dt><dd>{customer.tier}</dd>
            <dt>Country</dt><dd>{customer.country}</dd>
            <dt>Verified</dt><dd>{customer.verified ? 'yes' : 'no'}</dd>
          </dl>
        </div>
        <div>
          <h3>Order {order.order_id}</h3>
          <dl>
            <dt>Status</dt><dd>{order.status}</dd>
            <dt>Return window ends</dt><dd>{order.eligible_return_until ?? 'n/a'}</dd>
            <dt>Payment</dt><dd>{order.payment_status}</dd>
            <dt>Tracking</dt><dd>{order.tracking_number}</dd>
          </dl>
          <ul className="items">
            {order.items.map((item) => (
              <li key={item.sku}>
                {item.name} <span className="muted">({item.sku}{item.final_sale ? ', final sale' : ''})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
