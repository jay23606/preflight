create table refunds (
  id uuid primary key,
  order_id uuid not null references orders(id),
  amount_cents integer not null
);
