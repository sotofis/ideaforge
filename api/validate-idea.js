const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwywjvtmxxgqeqiedskj.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify user
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { ideaId } = req.body;
  if (!ideaId) return res.status(400).json({ error: 'ideaId required' });

  try {
    // Verify user owns the idea
    const { data: idea, error: ideaErr } = await supabase
      .from('ideas')
      .select('id, problem')
      .eq('id', ideaId)
      .eq('user_id', user.id)
      .single();

    if (ideaErr || !idea) return res.status(404).json({ error: 'Idea not found' });

    // Check user has validation credits
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('validation_credits')
      .eq('user_id', user.id)
      .single();

    if (profileErr || !profile) return res.status(404).json({ error: 'Profile not found' });
    if (profile.validation_credits <= 0) return res.status(403).json({ error: 'No validation credits remaining' });

    // Check no pending/researching job exists for this idea
    const { data: existingJobs } = await supabase
      .from('validation_jobs')
      .select('id')
      .eq('idea_id', ideaId)
      .in('status', ['pending', 'researching']);

    if (existingJobs && existingJobs.length > 0) {
      return res.status(409).json({ error: 'A validation job is already in progress for this idea' });
    }

    // Create validation job
    const { data: job, error: jobErr } = await supabase
      .from('validation_jobs')
      .insert({
        idea_id: ideaId,
        user_id: user.id,
        status: 'pending'
      })
      .select('id')
      .single();

    if (jobErr) throw jobErr;

    // Update idea validation status
    await supabase
      .from('ideas')
      .update({ validation_status: 'pending' })
      .eq('id', ideaId);

    // Decrement validation credits
    await supabase
      .from('profiles')
      .update({ validation_credits: profile.validation_credits - 1 })
      .eq('user_id', user.id);

    // Fire and forget — call Supabase Edge Function
    fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/validate-idea`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({ jobId: job.id, ideaId, problem: idea.problem })
    }).catch(() => {});

    res.status(200).json({ jobId: job.id, status: 'pending' });
  } catch (err) {
    console.error('Validate idea error:', err);
    res.status(500).json({ error: err.message });
  }
};
