const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwywjvtmxxgqeqiedskj.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Disable body parsing for webhook signature verification
module.exports.config = { api: { bodyParser: false } };

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send('Webhook signature verification failed');
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        if (!userId) break;

        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = subscription.items.data[0]?.price?.id;
        const interval = subscription.items.data[0]?.price?.recurring?.interval;
        const intervalCount = subscription.items.data[0]?.price?.recurring?.interval_count || 1;

        let plan = 'free';
        if (interval === 'year') plan = 'yearly';
        else if (interval === 'month' && intervalCount === 3) plan = 'quarterly';
        else if (interval === 'month') plan = 'quarterly';

        await supabase.from('profiles').update({
          plan: plan,
          subscription_status: subscription.status === 'trialing' ? 'trialing' : 'active',
          trial_ends_at: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          stripe_customer_id: session.customer
        }).eq('user_id', userId);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('stripe_customer_id', sub.customer);

        if (profiles?.length) {
          const interval = sub.items.data[0]?.price?.recurring?.interval;
          const intervalCount = sub.items.data[0]?.price?.recurring?.interval_count || 1;
          let plan = 'free';
          if (interval === 'year') plan = 'yearly';
          else if (interval === 'month') plan = 'quarterly';

          let status = sub.status;
          if (status === 'trialing') status = 'trialing';
          else if (status === 'active') status = 'active';
          else if (status === 'canceled' || status === 'unpaid') status = 'canceled';
          else if (status === 'past_due') status = 'past_due';
          else status = 'none';

          await supabase.from('profiles').update({
            plan: sub.cancel_at_period_end ? plan : plan,
            subscription_status: status,
            trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
            current_period_end: new Date(sub.current_period_end * 1000).toISOString()
          }).eq('user_id', profiles[0].user_id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('stripe_customer_id', sub.customer);

        if (profiles?.length) {
          await supabase.from('profiles').update({
            plan: 'free',
            subscription_status: 'canceled',
            current_period_end: null,
            trial_ends_at: null
          }).eq('user_id', profiles[0].user_id);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('stripe_customer_id', invoice.customer);

        if (profiles?.length) {
          await supabase.from('profiles').update({
            subscription_status: 'past_due'
          }).eq('user_id', profiles[0].user_id);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  // Always return 200 to Stripe
  res.status(200).json({ received: true });
};
