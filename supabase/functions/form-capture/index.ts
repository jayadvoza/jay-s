import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Secrets — set in Supabase Dashboard → Edge Functions → Secrets
// ---------------------------------------------------------------------------
const SUPABASE_URL            = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GHL_API_KEY             = Deno.env.get("GHL_API_KEY") ?? "";
const GHL_LOCATION_ID         = Deno.env.get("GHL_LOCATION_ID") ?? "";

// ---------------------------------------------------------------------------
// CORS — required because the JS snippet runs on a GHL landing page (different origin)
// ---------------------------------------------------------------------------
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The full APP.data object from the ConstrAction wizard */
interface WizardData {
  // Entity type: "company" | "individual" | "other"
  selfET?: string;

  // Company fields
  selfCN?: string; // company name
  selfRN?: string; // rep name
  selfEM?: string; // company email
  selfPH?: string; // company phone

  // Individual fields
  selfIN?: string; // full name
  selfIE?: string; // email
  selfIP?: string; // phone

  // Other entity
  selfOR?: string; // rep name
  selfON?: string; // org name
  selfOE?: string; // email
  selfOT?: string; // phone

  // Project
  projectName?: string;
  siteAddr?: string;
  siteCity?: string;
  sitePostal?: string;
  totalPrice?: string;
  signDate?: string;
  startDate?: string;
  endDate?: string;
  endNum?: string;
  endUnit?: string;
  payMethod?: string;
  workDesc?: string;

  [key: string]: unknown;
}

interface RequestBody {
  session_id: string;
  step_reached: number;
  form_data: WizardData;
  completed: boolean;
}

interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  company: string;
}

// ---------------------------------------------------------------------------
// Extract contact fields from wizard data
// (mirrors the sendToGHL() logic in the HTML)
// ---------------------------------------------------------------------------
function extractContact(data: WizardData): ContactInfo {
  const et = data.selfET ?? "";
  let firstName = "", lastName = "", email = "", phone = "", company = "";

  if (et === "company") {
    const parts = (data.selfRN ?? "").split(" ");
    firstName = parts[0] ?? "";
    lastName  = parts.slice(1).join(" ");
    email     = data.selfEM ?? "";
    phone     = data.selfPH ?? "";
    company   = data.selfCN ?? "";
  } else if (et === "individual") {
    const parts = (data.selfIN ?? "").split(" ");
    firstName = parts[0] ?? "";
    lastName  = parts.slice(1).join(" ");
    email     = data.selfIE ?? "";
    phone     = data.selfIP ?? "";
  } else {
    // "other" entity type
    const parts = (data.selfOR ?? "").split(" ");
    firstName = parts[0] ?? "";
    lastName  = parts.slice(1).join(" ");
    email     = data.selfOE ?? "";
    phone     = data.selfOT ?? "";
    company   = data.selfON ?? "";
  }

  return { firstName, lastName, email, phone, company };
}

// ---------------------------------------------------------------------------
// Create / update contact in GHL via REST API v1
// ---------------------------------------------------------------------------
async function upsertGHLContact(
  contact: ContactInfo,
  data: WizardData
): Promise<string | null> {
  if (!contact.email && !contact.phone) return null; // nothing to identify the contact with

  const projectAddr = [data.siteAddr, data.siteCity, data.sitePostal]
    .filter(Boolean)
    .join(", ");

  const body = {
    locationId:  GHL_LOCATION_ID,
    firstName:   contact.firstName,
    lastName:    contact.lastName,
    email:       contact.email    || undefined,
    phone:       contact.phone    || undefined,
    companyName: contact.company  || undefined,
    source:      "ConstrAction Contract Generator",
    tags:        ["constraction-form"],
    customField: {
      project_name:    data.projectName   ?? "",
      project_address: projectAddr,
      total_price:     data.totalPrice    ?? "",
      payment_method:  data.payMethod     ?? "",
      start_date:      data.startDate     ?? "",
      work_description: data.workDesc     ?? "",
    },
  };

  const res = await fetch("https://rest.gohighlevel.com/v1/contacts/", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:  `Bearer ${GHL_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`GHL API error ${res.status}:`, errText);
    return null;
  }

  const json = await res.json();
  return (json?.contact?.id ?? json?.id ?? null) as string | null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  // Parse body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400, headers: CORS_HEADERS });
  }

  const { session_id, step_reached, form_data, completed } = body;

  if (!session_id || typeof session_id !== "string") {
    return new Response("Missing session_id", { status: 400, headers: CORS_HEADERS });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const contact  = extractContact(form_data ?? {});

  // Push to GHL only when the form is fully submitted
  let ghl_contact_id: string | null = null;
  if (completed && GHL_API_KEY && GHL_LOCATION_ID) {
    ghl_contact_id = await upsertGHLContact(contact, form_data ?? {});
  }

  // Upsert form_sessions (insert or update by session_id)
  const { data: row, error } = await supabase
    .from("form_sessions")
    .upsert(
      {
        session_id,
        step_reached,
        completed,
        form_data: form_data ?? {},
        first_name:   contact.firstName || null,
        last_name:    contact.lastName  || null,
        email:        contact.email     || null,
        phone:        contact.phone     || null,
        project_name: form_data?.projectName ?? null,
        ...(ghl_contact_id ? { ghl_contact_id } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" }
    )
    .select("id, ghl_contact_id")
    .single();

  if (error) {
    console.error("Supabase upsert error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ success: true, id: row?.id, ghl_contact_id: row?.ghl_contact_id }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
