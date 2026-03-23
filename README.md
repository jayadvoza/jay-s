# GHL Form → Supabase → GHL Contact Integration

## How it works

```
GHL Landing Page Form
        │
        ▼ (webhook POST)
Supabase Edge Function
        │
        ├──► Supabase DB  (saves lead to `leads` table)
        │
        └──► GHL API      (creates/updates contact in CRM)
```

---

## Setup Guide

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Run the migration to create the `leads` table:
   - Open **SQL Editor** in your Supabase dashboard
   - Paste and run the contents of `supabase/migrations/001_create_leads_table.sql`

### 2. Deploy the Edge Function

Install the Supabase CLI if you haven't:
```bash
npm install -g supabase
```

Login and link your project:
```bash
supabase login
supabase link --project-ref your-project-id
```

Deploy the function:
```bash
supabase functions deploy ghl-webhook
```

### 3. Set Edge Function secrets

In the Supabase dashboard → **Edge Functions** → `ghl-webhook` → **Secrets**, add:

| Secret name                | Value                          |
|----------------------------|--------------------------------|
| `SUPABASE_URL`             | Your Supabase project URL      |
| `SUPABASE_SERVICE_ROLE_KEY`| Your service role key          |
| `GHL_API_KEY`              | Your GHL private API key       |
| `GHL_LOCATION_ID`          | Your GHL location/sub-account ID |
| `WEBHOOK_SECRET`           | Any random string (optional)   |

Or set them via CLI:
```bash
supabase secrets set GHL_API_KEY=xxx GHL_LOCATION_ID=xxx WEBHOOK_SECRET=xxx
```

### 4. Get your webhook URL

After deploying, your Edge Function URL will be:
```
https://your-project-id.supabase.co/functions/v1/ghl-webhook
```

### 5. Configure GHL to send form data to the webhook

1. In GHL, go to your **Landing Page** → **Form settings**
2. Find **Integrations** or **Webhook** settings
3. Paste your Supabase Edge Function URL
4. If you set a `WEBHOOK_SECRET`, add a custom header:
   - Header name: `x-webhook-secret`
   - Header value: your secret

---

## Form fields mapping

The Edge Function maps these GHL form field names to the `leads` table:

| GHL field name | Supabase column  | GHL contact field |
|----------------|------------------|-------------------|
| `first_name`   | `first_name`     | `firstName`       |
| `last_name`    | `last_name`      | `lastName`        |
| `email`        | `email`          | `email`           |
| `phone`        | `phone`          | `phone`           |
| `message`      | `message`        | *(not sent)*      |
| any other field| `raw_payload`    | `customFields`    |

> **Note:** Make sure your GHL form field names match the names in the table above. You can rename them in GHL's form builder.

---

## Supabase leads table schema

| Column           | Type        | Description                          |
|------------------|-------------|--------------------------------------|
| `id`             | uuid        | Auto-generated primary key           |
| `first_name`     | text        | From form                            |
| `last_name`      | text        | From form                            |
| `email`          | text        | From form                            |
| `phone`          | text        | From form                            |
| `message`        | text        | From form                            |
| `source`         | text        | Default: `ghl_form`                  |
| `ghl_contact_id` | text        | GHL contact ID after creation        |
| `raw_payload`    | jsonb       | Full original webhook payload        |
| `created_at`     | timestamptz | Timestamp of submission              |
