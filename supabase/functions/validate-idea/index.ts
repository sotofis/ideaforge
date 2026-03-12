import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestBody {
  jobId: string
  ideaId: string
  problem: string
}

interface MarketResearch {
  size: string
  growth_rate: string
  trends: string[]
  tam: string
  sam: string
  som: string
  summary: string
}

interface Competitor {
  name: string
  url: string
  pricing: string
  strengths: string[]
  weaknesses: string[]
  market_share: string
}

interface CompetitionAnalysis {
  competitors: Competitor[]
  summary: string
  gap_analysis: string
}

interface NeedValidation {
  pain_points: string[]
  evidence: string[]
  sentiment: string
  demand_level: string
  summary: string
}

interface BusinessModelAssessment {
  suggested_models: string[]
  revenue_potential: string
  pricing_strategy: string
  risks: string[]
  summary: string
}

interface TechnicalFeasibility {
  complexity: string
  suggested_stack: string[]
  timeline: string
  key_challenges: string[]
  mvp_features: string[]
  summary: string
}

interface Synthesis {
  market_score: number
  competition_score: number
  need_score: number
  business_score: number
  technical_score: number
  executive_summary: string
  recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function updateProgress(
  supabase: SupabaseClient,
  jobId: string,
  progress: number,
  status?: string,
) {
  const update: Record<string, unknown> = {
    progress,
    updated_at: new Date().toISOString(),
  }
  if (status) update.status = status
  await supabase.from('validation_jobs').update(update).eq('id', jobId)
}

async function callClaude(system: string, userMessage: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!

  const doRequest = async (): Promise<string> => {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!resp.ok) {
      const errBody = await resp.text()
      throw new Error(`Claude API error ${resp.status}: ${errBody}`)
    }

    const data = await resp.json()
    return data.content[0].text
  }

  // Attempt once, retry after 2 s on failure.
  try {
    return await doRequest()
  } catch (err) {
    console.warn('Claude API call failed, retrying in 2 s...', (err as Error).message)
    await new Promise((r) => setTimeout(r, 2000))
    return await doRequest()
  }
}

async function braveSearch(query: string): Promise<string> {
  const apiKey = Deno.env.get('BRAVE_SEARCH_API_KEY')!
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`

  const resp = await fetch(url, {
    headers: { 'X-Subscription-Token': apiKey },
  })

  if (!resp.ok) {
    const errBody = await resp.text()
    throw new Error(`Brave Search error ${resp.status}: ${errBody}`)
  }

  const data = await resp.json()
  const results = (data.web?.results ?? []) as Array<{
    title: string
    url: string
    description: string
  }>

  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.description}`)
    .join('\n\n')
}

function parseJSON<T>(raw: string): T {
  // Claude sometimes wraps JSON in markdown code fences — strip them.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  return JSON.parse(cleaned) as T
}

// ---------------------------------------------------------------------------
// Research tasks
// ---------------------------------------------------------------------------

async function marketResearch(problem: string): Promise<MarketResearch> {
  const snippets = await braveSearch(`${problem} market size trends 2025 2026`)

  const system =
    'You are a market research analyst. Analyze these search results about a business idea and return JSON with: { size: string, growth_rate: string, trends: string[], tam: string, sam: string, som: string, summary: string }. Be specific with numbers when data supports it. Return ONLY valid JSON, no markdown.'

  const raw = await callClaude(system, `Search results:\n\n${snippets}\n\nBusiness idea / problem:\n${problem}`)
  return parseJSON<MarketResearch>(raw)
}

async function competitionAnalysis(problem: string): Promise<CompetitionAnalysis> {
  const snippets = await braveSearch(`${problem} competitors existing solutions pricing reviews`)

  const system =
    'You are a competitive intelligence analyst. Analyze these search results and return JSON with: { competitors: [{ name, url, pricing, strengths, weaknesses, market_share }], summary: string, gap_analysis: string }. Return ONLY valid JSON, no markdown.'

  const raw = await callClaude(system, `Search results:\n\n${snippets}\n\nBusiness idea / problem:\n${problem}`)
  return parseJSON<CompetitionAnalysis>(raw)
}

async function needValidation(problem: string): Promise<NeedValidation> {
  const snippets = await braveSearch(`${problem} frustration complaints need reddit forum`)

  const system =
    'You are a user research analyst. Analyze these search results for evidence of real user need and return JSON with: { pain_points: string[], evidence: string[], sentiment: string, demand_level: string, summary: string }. Return ONLY valid JSON, no markdown.'

  const raw = await callClaude(system, `Search results:\n\n${snippets}\n\nBusiness idea / problem:\n${problem}`)
  return parseJSON<NeedValidation>(raw)
}

async function businessModelAssessment(
  problem: string,
  marketData: MarketResearch | null,
  competitionData: CompetitionAnalysis | null,
): Promise<BusinessModelAssessment> {
  const system =
    'You are a business model strategist. Given a problem statement and supporting market/competition research, return JSON with: { suggested_models: string[], revenue_potential: string, pricing_strategy: string, risks: string[], summary: string }. Return ONLY valid JSON, no markdown.'

  const context = [
    `Problem: ${problem}`,
    marketData ? `Market research: ${JSON.stringify(marketData)}` : 'Market research: unavailable',
    competitionData ? `Competition analysis: ${JSON.stringify(competitionData)}` : 'Competition analysis: unavailable',
  ].join('\n\n')

  const raw = await callClaude(system, context)
  return parseJSON<BusinessModelAssessment>(raw)
}

async function technicalFeasibility(problem: string): Promise<TechnicalFeasibility> {
  const system =
    'You are a senior software architect. Evaluate the technical feasibility of building a solution for the given problem and return JSON with: { complexity: string, suggested_stack: string[], timeline: string, key_challenges: string[], mvp_features: string[], summary: string }. Return ONLY valid JSON, no markdown.'

  const raw = await callClaude(system, `Problem: ${problem}`)
  return parseJSON<TechnicalFeasibility>(raw)
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

async function synthesize(
  problem: string,
  market: MarketResearch | null,
  competition: CompetitionAnalysis | null,
  need: NeedValidation | null,
  business: BusinessModelAssessment | null,
  technical: TechnicalFeasibility | null,
): Promise<Synthesis> {
  const system =
    'You are a startup advisor synthesizing research about a business idea. Given the 5 research reports, produce:\n' +
    '1. A score from 1-10 for each dimension (market, competition favorability, need/demand, business model viability, technical feasibility)\n' +
    '2. An executive summary (2-3 paragraphs)\n' +
    '3. A recommendation: strong_yes, yes, maybe, no, or strong_no\n' +
    'Return as JSON: { market_score, competition_score, need_score, business_score, technical_score, executive_summary, recommendation }. Return ONLY valid JSON, no markdown.'

  const reports = [
    `Problem: ${problem}`,
    `Market Research: ${market ? JSON.stringify(market) : 'FAILED — no data available'}`,
    `Competition Analysis: ${competition ? JSON.stringify(competition) : 'FAILED — no data available'}`,
    `Need Validation: ${need ? JSON.stringify(need) : 'FAILED — no data available'}`,
    `Business Model Assessment: ${business ? JSON.stringify(business) : 'FAILED — no data available'}`,
    `Technical Feasibility: ${technical ? JSON.stringify(technical) : 'FAILED — no data available'}`,
  ].join('\n\n')

  const raw = await callClaude(system, reports)
  return parseJSON<Synthesis>(raw)
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  let jobId: string | undefined

  try {
    // 1. Parse request body
    const { jobId: jid, ideaId, problem } = (await req.json()) as RequestBody
    jobId = jid

    if (!jobId || !ideaId || !problem) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: jobId, ideaId, problem' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 2. Update job → researching
    await supabase
      .from('validation_jobs')
      .update({
        status: 'researching',
        started_at: new Date().toISOString(),
        progress: 5,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    // 3. Fetch job to get user_id
    const { data: jobData } = await supabase
      .from('validation_jobs')
      .select('user_id')
      .eq('id', jobId)
      .single()
    const userId = jobData?.user_id

    // Fetch the idea for full context
    const { data: idea, error: ideaError } = await supabase
      .from('ideas')
      .select('*')
      .eq('id', ideaId)
      .single()

    if (ideaError) {
      console.error('Failed to fetch idea:', ideaError)
    }

    const fullProblem = idea?.description
      ? `${problem}\n\nAdditional context: ${idea.description}`
      : problem

    // 4. Run the 5 research tasks in parallel
    //    Tasks a-c are independent; d depends on a & b; e is independent.
    //    We run a, b, c, e in parallel first, then d with their results.

    // Phase 1 — independent tasks
    const [marketResult, competitionResult, needResult, technicalResult] = await Promise.allSettled([
      marketResearch(fullProblem),
      competitionAnalysis(fullProblem),
      needValidation(fullProblem),
      technicalFeasibility(fullProblem),
    ])

    const marketData = marketResult.status === 'fulfilled' ? marketResult.value : null
    const competitionData = competitionResult.status === 'fulfilled' ? competitionResult.value : null
    const needData = needResult.status === 'fulfilled' ? needResult.value : null
    const technicalData = technicalResult.status === 'fulfilled' ? technicalResult.value : null

    if (marketResult.status === 'rejected') console.error('Market research failed:', marketResult.reason)
    if (competitionResult.status === 'rejected') console.error('Competition analysis failed:', competitionResult.reason)
    if (needResult.status === 'rejected') console.error('Need validation failed:', needResult.reason)
    if (technicalResult.status === 'rejected') console.error('Technical feasibility failed:', technicalResult.reason)

    // Update progress after phase 1 completes (covers tasks up to ~75)
    await updateProgress(supabase, jobId, 75)

    // Phase 2 — business model depends on market + competition
    let businessData: BusinessModelAssessment | null = null
    try {
      businessData = await businessModelAssessment(fullProblem, marketData, competitionData)
    } catch (err) {
      console.error('Business model assessment failed:', err)
    }

    await updateProgress(supabase, jobId, 80)

    // 5. Track which tasks failed
    const failedTasks: string[] = []
    if (!marketData) failedTasks.push('market_research')
    if (!competitionData) failedTasks.push('competition_analysis')
    if (!needData) failedTasks.push('need_validation')
    if (!businessData) failedTasks.push('business_model')
    if (!technicalData) failedTasks.push('technical_feasibility')

    // 6. Synthesis
    await updateProgress(supabase, jobId, 90)

    const synthesis = await synthesize(
      fullProblem,
      marketData,
      competitionData,
      needData,
      businessData,
      technicalData,
    )

    // 7. Persist results
    await updateProgress(supabase, jobId, 95)

    const overallScore = Math.round(
      (synthesis.market_score +
        synthesis.competition_score +
        synthesis.need_score +
        synthesis.business_score +
        synthesis.technical_score) /
        5,
    )

    // INSERT validation report
    const { error: reportError } = await supabase.from('validation_reports').insert({
      idea_id: ideaId,
      job_id: jobId,
      user_id: userId,
      market_analysis: marketData,
      competition: competitionData,
      need_validation: needData,
      business_model: businessData,
      technical_feasibility: technicalData,
      market_score: synthesis.market_score,
      competition_score: synthesis.competition_score,
      need_score: synthesis.need_score,
      business_score: synthesis.business_score,
      technical_score: synthesis.technical_score,
      executive_summary: synthesis.executive_summary,
      recommendation: synthesis.recommendation,
      created_at: new Date().toISOString(),
    })

    if (reportError) {
      console.error('Failed to insert validation report:', reportError)
      throw new Error(`Failed to insert validation report: ${reportError.message}`)
    }

    // UPDATE validation job → complete
    await supabase
      .from('validation_jobs')
      .update({
        status: 'complete',
        progress: 100,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    // UPDATE idea → validation complete
    await supabase
      .from('ideas')
      .update({
        validation_status: 'complete',
        ai_overall_score: overallScore,
        updated_at: new Date().toISOString(),
      })
      .eq('id', ideaId)

    return new Response(
      JSON.stringify({
        success: true,
        overall_score: overallScore,
        recommendation: synthesis.recommendation,
        failed_tasks: failedTasks.length > 0 ? failedTasks : undefined,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Validation function failed:', message)

    // Mark job as failed if we have a jobId
    if (jobId) {
      try {
        await supabase
          .from('validation_jobs')
          .update({
            status: 'failed',
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId)
      } catch (updateErr) {
        console.error('Failed to update job status to failed:', updateErr)
      }
    }

    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
