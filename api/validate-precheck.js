const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwywjvtmxxgqeqiedskj.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { problem, audience, advantage } = req.body;
  if (!problem) return res.status(400).json({ error: 'Problem description required' });

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: `You evaluate whether a business idea description is specific enough for meaningful market research. You receive three inputs: problem statement, target audience, and unfair advantage.

If the inputs are specific and clear enough to research (has a concrete problem, identifiable audience), respond with JSON: {"clear": true}

If the inputs are too vague or missing critical details, respond with JSON: {"clear": false, "questions": "Your 1-2 clarifying questions here as a single string. Be concise and specific about what's missing."}

Examples of too vague: "help people save money", "an app for businesses", "something with AI"
Examples of specific enough: "reduce food waste in restaurants by predicting demand", "help freelance designers find clients through portfolio matching"

Return ONLY valid JSON, no markdown.`,
        messages: [{
          role: 'user',
          content: `Problem: ${problem}\nTarget audience: ${audience || 'Not specified'}\nUnfair advantage: ${advantage || 'Not specified'}`
        }]
      })
    });

    const data = await resp.json();
    const text = data.content[0].text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const result = JSON.parse(text);

    res.status(200).json(result);
  } catch (err) {
    console.error('Precheck error:', err);
    res.status(500).json({ error: err.message });
  }
};
