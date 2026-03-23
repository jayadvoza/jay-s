import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Environment variables (set these in Supabase Dashboard → Edge Functions → Secrets)
// ---------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GHL_API_KEY = Deno.env.get("GHL_API_KEY")!;           // GHL private integration key
const GHL_LOCATION_ID = Deno.env.get("GHL_LOCATION_ID")!;   // GHL sub-account location ID
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET") ?? ""; // optional: verify incoming requests

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface GHLFormPayload {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  message?: string;
  [key: string]: unknown; // allow any extra fields GHL sends
}

interface GHLContactBody {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  locationId: string;
  source?: string;
  customFields?: { key: string; field_value: string }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Save lead to Supabase and return the inserted row */
async function saveLead(
  supabase: ReturnType<typeof createClient>,
  payload: GHLFormPayload,
  ghlContactId: string | null
) {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      first_name: payload.first_name ?? null,
      last_name: payload.last_name ?? null,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      message: payload.message ?? null,
      ghl_contact_id: ghlContactId,
      raw_payload: payload,
    })
    .select()
    .single();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data;
}

/** Create or update a contact in GHL via their REST API */
async function upsertGHLContact(payload: GHLFormPayload): Promise<string> {
  const body: GHLContactBody = {
    locationId: GHL_LOCATION_ID,
    firstName: payload.first_name,
    lastName: payload.last_name,
    email: payload.email,
    phone: payload.phone,
    source: "GHL Landing Page",
  };

  // If there are extra fields beyond the standard ones, map them as custom fields
  const standardKeys = new Set(["first_name", "last_name", "email", "phone", "message"]);
  const customFields = Object.entries(payload)
    .filter(([k]) => !standardKeys.has(k))
    .map(([k, v]) => ({ key: k, field_value: String(v) }));

  if (customFields.length > 0) {
    body.customFields = customFields;
  }

  const res = await fetch("https://rest.gohighlevel.com/v1/contacts/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GHL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GHL API error ${res.status}: ${errText}`);
  }

  const json = await res.json();
  // GHL returns { contact: { id: "...", ... } }
  return json?.contact?.id ?? json?.id ?? "";
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Optional: verify webhook secret header
  if (WEBHOOK_SECRET) {
    const secret = req.headers.get("x-webhook-secret");
    if (secret !== WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let payload: GHLFormPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Push to GHL first so we can store the contact ID
    const ghlContactId = await upsertGHLContact(payload);

    // 2. Save lead to Supabase (includes the GHL contact ID)
    const lead = await saveLead(supabase, payload, ghlContactId);

    return new Response(
      JSON.stringify({ success: true, leadId: lead.id, ghlContactId }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook handler error:", err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
