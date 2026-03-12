# IdeaForge: AI Validation, Landing Page Generation & MVP Builder

## Architecture Overview

```
[User in PWA]
    |
    v
[Vercel Serverless API Layer]
    |         |          |
    v         v          v
[Agent       [Landing    [Signup
 Orchestrator] Page Gen]  Tracker]
    |              |          |
    v              v          v
[Supabase Postgres + Storage]
    |
    v
[External AI & Data Sources]
   - Claude API (reasoning, copy, code generation)
   - Brave Search API (market research, competition)
   - Reddit API (need validation)
   - Supabase Edge Functions (long-running agent work)
```

## The Three Phases

### Phase 1: AI Validation Engine (Weeks 1-3)

**"Validate Idea" button → AI agents research → structured report**

5 parallel research agents run via Supabase Edge Function:

1. **Market Research** — Brave Search → Claude synthesizes market size, growth, trends, TAM/SAM/SOM
2. **Competition Analysis** — Brave Search → Claude extracts competitor profiles, pricing, strengths/weaknesses
3. **Need Validation** — Reddit API + Brave Search → Claude analyzes pain points, sentiment
4. **Business Model** — Claude assesses revenue potential, pricing strategy, suggested models
5. **Technical Feasibility** — Claude evaluates complexity, stack suggestion, timeline, risks

Each dimension scored 1-10. Final output: executive summary + go/no-go recommendation.

**Why Supabase Edge Functions (not Vercel)?** Vercel hobby plan has 10s timeout. Multi-API research takes 30-60s. Edge Functions allow up to 150s (free) / 540s (pro).

Progress tracked via Supabase Realtime (no polling needed).

### Phase 2: Landing Page Generation (Weeks 4-5)

**Validated idea → AI-generated landing page → email signup collection**

- Claude generates copy from validation report (headline, value props, CTA)
- Content injected into pre-built HTML templates (3-4 styles)
- Stored in Supabase Storage (public bucket), served at `/p/{slug}`
- Public signup form, no auth required for visitors
- Signup threshold configurable per page (default: 100)
- Email notification via Resend when threshold hit

### Phase 3: MVP Builder (Weeks 6-8)

**Threshold reached → "Let Claude build this?" → autonomous code generation**

- Claude Opus generates project scaffold from idea + report + signups data
- Output: downloadable ZIP or auto-created GitHub repo
- Optional: auto-deploy to Vercel via API

## Database Schema Additions

### `validation_jobs`
- id, idea_id, user_id, status (pending/researching/analyzing/complete/failed), progress (0-100)

### `validation_reports`
- id, job_id, idea_id, user_id
- market_analysis (jsonb), competition (jsonb), need_validation (jsonb), business_model (jsonb), technical_feasibility (jsonb)
- market_score, competition_score, need_score, business_score, technical_score (1-10 each)
- overall_score (generated avg), executive_summary, recommendation (strong_yes/yes/maybe/no/strong_no)

### `landing_pages`
- id, idea_id, user_id, report_id, slug (unique), title, headline, subheadline, value_props (jsonb)
- html_storage_path, is_published, signup_threshold, signup_count, view_count

### `landing_page_signups`
- id, landing_page_id, email, referrer, ip_hash, created_at
- Public insert (no auth), owner-only read

### Additions to existing tables
- `ideas`: validation_status, has_landing_page, ai_overall_score
- `profiles`: validation_credits, landing_page_credits

## API Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/validate-idea` | Yes | Trigger validation, returns jobId |
| `GET /api/validation-status` | Yes | Check job progress |
| `GET /api/validation-report` | Yes | Fetch completed report |
| `POST /api/generate-landing-page` | Yes | Generate + publish landing page |
| `GET /api/serve-landing-page` | No | Serve published page at /p/{slug} |
| `POST /api/landing-page-signup` | No | Public email collection |
| `PATCH /api/landing-page` | Yes | Edit page settings |
| `GET /api/landing-page-stats` | Yes | View analytics |

## Cost Per Validation: ~$0.15

- Claude Sonnet (~6 calls): ~$0.12
- Brave Search (~10 queries): ~$0.03
- Reddit API: Free
- Edge Function compute: Free tier

## Pricing Model

- **Free plan**: 0 validations, can view sample report
- **Pro plan**: 3 validations/month + 2 landing pages/month included
- **Credit packs**: $1.99 for 5 additional validations (via Stripe)

## New Files to Create

- `api/validate-idea.js`, `api/validation-status.js`, `api/validation-report.js`
- `api/generate-landing-page.js`, `api/serve-landing-page.js`, `api/landing-page-signup.js`
- `supabase/functions/validate-idea/index.ts` (Edge Function)
- `migration-v3-validation.sql`
- `templates/landing-page-default.html`

## Tech Stack Additions

| Concern | Tech | Why |
|---------|------|-----|
| AI | Claude Sonnet (research), Opus (MVP gen) | Best cost/quality ratio |
| Web Search | Brave Search API ($3/1000 queries) | Simple, cheap |
| Forum Mining | Reddit API (free tier) | Direct pain-point access |
| Long Jobs | Supabase Edge Functions | 150s+ timeout |
| Landing Pages | Supabase Storage + Vercel rewrites | No extra infra |
| Email Notify | Resend (free 3000/mo) | Simple REST API |

## Key Design Decisions

1. **JSONB for research results** — Schema will evolve rapidly, avoids constant migrations
2. **Static HTML in Storage** — No CMS needed, pages load instantly
3. **Credit-based access** — At $0.15/validation, unlimited would bankrupt at $9.99/yr
4. **Supabase Realtime for progress** — Native integration, no WebSocket server needed
5. **Pre-built templates + AI content** — More reliable than full AI HTML generation
