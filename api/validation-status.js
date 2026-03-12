const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwywjvtmxxgqeqiedskj.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Verify user
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { jobId } = req.query;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });

  try {
    const { data: job, error: jobErr } = await supabase
      .from('validation_jobs')
      .select('status, progress, started_at, completed_at, error_message')
      .eq('id', jobId)
      .eq('user_id', user.id)
      .single();

    if (jobErr || !job) return res.status(404).json({ error: 'Job not found' });

    res.status(200).json(job);
  } catch (err) {
    console.error('Validation status error:', err);
    res.status(500).json({ error: err.message });
  }
};
