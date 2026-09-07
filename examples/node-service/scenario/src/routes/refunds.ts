import Stripe from 'stripe';

// New endpoint, shipped in a hurry.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function refundRoute(orderId: string, amountCents: number) {
  if (process.env.REFUNDS_ENABLED !== 'true') throw new Error('refunds disabled');
  return stripe.refunds.create({ payment_intent: orderId, amount: amountCents });
}
