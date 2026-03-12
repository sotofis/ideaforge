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

  const { ideaId } = req.query;
  if (!ideaId) return res.status(400).json({ error: 'ideaId required' });

  try {
    const { data: report, error: reportErr } = await supabase
      .from('validation_reports')
      .select('*')
      .eq('idea_id', ideaId)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (reportErr || !report) return res.status(404).json({ error: 'No report found' });

    res.status(200).json(report);
  } catch (err) {
    console.error('Validation report error:', err);
    res.status(500).json({ error: err.message });
  }
};
