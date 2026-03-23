# ConstrAction Form → Supabase → GHL Integration

## How it works

```
User opens GHL landing page (constraction.ca/test)
         │
         │  tracker.js injected into the page
         │
         ├──► On every slide advance (goNext)
         │         │
         │         └──► Supabase Edge Function (form-capture)
         │                   │
         │                   └──► Upsert form_sessions table
         │                         (session_id links all slides together)
         │
         └──► On final submit (Generate My Contract)
                   │
                   └──► Supabase Edge Function (form-capture)
                             │
                             ├──► Upsert form_sessions  (completed = true)
                             │
                             └──► GHL REST API → Create / Update Contact
```

**Key feature:** Every slide is saved progressively, even if the user never
finishes the form. You can use that partial data to follow up, autofill a
payment form, send a re-engagement email, etc.

---

## Files

| File | Purpose |
|------|---------|
| `supabase/migrations/001_create_leads_table.sql` | Legacy leads table (GHL webhook flow) |
| `supabase/migrations/002_create_form_sessions.sql` | Progressive form capture table |
| `supabase/functions/ghl-webhook/index.ts` | Legacy: receive webhook FROM GHL |
| `supabase/functions/form-capture/index.ts` | **Main**: receive slide data from the JS tracker |
| `ghl-snippet/tracker.js` | **Inject this into your GHL landing page** |

---

## Setup Guide

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Run both SQL migrations in **SQL Editor**:
   - `supabase/migrations/001_create_leads_table.sql`
   - `supabase/migrations/002_create_form_sessions.sql`

### 2. Deploy the Edge Function

```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_ID
supabase functions deploy form-capture
```

### 3. Set Edge Function secrets

In Supabase Dashboard → **Edge Functions** → `form-capture` → **Secrets**:

| Secret | Value |
|--------|-------|
| `SUPABASE_URL` | `https://YOUR_PROJECT_ID.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Your service role key (Settings → API) |
| `GHL_API_KEY` | Your GHL private integration key |
| `GHL_LOCATION_ID` | Your GHL sub-account location ID |

Or via CLI:
```bash
supabase secrets set \
  GHL_API_KEY=xxx \
  GHL_LOCATION_ID=xxx
```

### 4. Update the tracker snippet

Open `ghl-snippet/tracker.js` and replace the URL:

```js
var CAPTURE_URL = 'https://YOUR_PROJECT_ID.supabase.co/functions/v1/form-capture';
```

Replace `YOUR_PROJECT_ID` with your actual Supabase project ID (found in Settings → General).

### 5. Inject the snippet into your GHL landing page

1. In GHL, open your **Landing Page** editor (`constraction.ca/test`)
2. Go to **Settings** or **Custom Code**
3. Paste the entire contents of `ghl-snippet/tracker.js` inside `<script>` tags in the **Footer** section:
   ```html
   <script>
   /* paste tracker.js contents here */
   </script>
   ```
4. Save and publish.

---

## What gets saved to Supabase

Every time the user clicks "Next" or submits, the `form_sessions` table is updated:

| Column | Description |
|--------|-------------|
| `session_id` | Unique ID from the user's localStorage — links all slides |
| `step_reached` | Highest step they got to (1–12) |
| `completed` | `true` only if they clicked "Generate My Contract" |
| `first_name`, `last_name` | Extracted from wizard data |
| `email`, `phone` | Extracted from wizard data |
| `project_name` | From step 1 |
| `form_data` | Full `APP.data` JSON — every field from every slide |
| `ghl_contact_id` | GHL contact ID (populated on form completion) |
| `updated_at` | Timestamp of last update |

---

## Wizard steps reference

| Step | Page title | Key fields saved |
|------|-----------|-----------------|
| 0 | Role selection | `APP.role` |
| 1 | Project basics | `projectName`, `siteAddr`, `totalPrice`, `signDate` |
| 2 | Your info | `selfET`, `selfCN`/`selfIN`, `selfEM`/`selfIE`, `selfPH`/`selfIP` |
| 3 | Counterparty info | `ctrET`, `ctrCN`/`ctrIN`, etc. |
| 4 | Work description | `matProv`, `workDesc` |
| 5 | Schedule | `startDate`, `endDate`/`endNum` |
| 6 | Payment | `payMethod`, `lumpAmt`, milestones, `holdback` |
| 7 | Escalation | `escalation`, `escPct` |
| 8 | Late payment | `lateInt`, `recPen` |
| 9 | Warranty | `warMon` |
| 10 | Insurance | `insAmt`, `bond` |
| 11 | Acceptance | `accDays`, `susp1/2/3` |
| 12 | Extra clauses | `extraCl` |

---

## How to use saved data (autofill payment form, follow-up, etc.)

Query incomplete sessions in Supabase:

```sql
-- Leads who started but never finished
select session_id, first_name, last_name, email, step_reached, form_data, updated_at
from form_sessions
where completed = false
  and email is not null
order by updated_at desc;

-- Extract specific fields from form_data for autofill
select
  email,
  form_data->>'projectName'  as project,
  form_data->>'totalPrice'   as price,
  form_data->>'siteAddr'     as address,
  form_data->>'payMethod'    as payment_method
from form_sessions
where completed = true;
```

For payment form autofill, you can pass `session_id` as a URL param
and fetch the record via the Supabase JS SDK:

```js
const { data } = await supabase
  .from('form_sessions')
  .select('form_data')
  .eq('session_id', sessionId)
  .single();

// Then pre-populate your payment fields from data.form_data
```

---

## GHL contact fields

When a session completes, the Edge Function creates a GHL contact with:

| GHL field | Source in form_data |
|-----------|-------------------|
| `firstName` | `selfRN` (company rep) or `selfIN` (individual) |
| `lastName` | split from above |
| `email` | `selfEM` or `selfIE` or `selfOE` |
| `phone` | `selfPH` or `selfIP` or `selfOT` |
| `companyName` | `selfCN` or `selfON` |
| `customField.project_name` | `projectName` |
| `customField.project_address` | `siteAddr + siteCity + sitePostal` |
| `customField.total_price` | `totalPrice` |
| `customField.payment_method` | `payMethod` |
| `customField.start_date` | `startDate` |
| `customField.work_description` | `workDesc` |
