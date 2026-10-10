import { supabase } from "@/integrations/supabase/client";
import {
  costFor,
  reportCookieSpend,
  reportCookiesSettled,
  reportOutOfCookies,
} from "@/lib/cookies";
export { sections } from "../../supabase/functions/clerking/contract";
export type { Draft, Intake, SectionId } from "../../supabase/functions/clerking/contract";
import { parseDraft, parseIntake } from "../../supabase/functions/clerking/contract";
import type { Draft, Intake } from "../../supabase/functions/clerking/contract";

export async function clerkingAvailable(signal: AbortSignal): Promise<boolean | null> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/clerking`, {
    method: "GET",
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${data.session.access_token}`,
    },
    signal,
  });
  // The credit wrapper rejects GET with 405 before billing. A missing function
  // returns 404. This readiness check cannot spend patient credits.
  if (response.status === 405) return true;
  if (response.status === 404) return false;
  return null;
}

export async function generateClerking(input: Intake, signal: AbortSignal): Promise<Draft> {
  const intake = parseIntake(input);
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sign in to generate a clerking draft.");
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Clerking is not configured.");
  reportCookieSpend(costFor("clerking"));
  try {
    const response = await fetch(`${url}/functions/v1/clerking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify(intake),
      signal,
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 404)
        throw new Error(
          "Draft generation is not available yet. Your interview has been kept. Please ask the site administrator to activate patient clerking.",
        );
      if (response.status === 402 && result.error === "out_of_cookies") {
        reportOutOfCookies({ remaining: result.remaining, allowance: result.allowance });
        throw new Error("Not enough credits. Generating a clerking draft costs 2 credits.");
      }
      throw new Error(
        typeof result.error === "string" ? result.error : "The draft could not be generated.",
      );
    }
    return parseDraft(result, intake);
  } finally {
    reportCookiesSettled();
  }
}

export function draftText(draft: Draft, reviewed: boolean) {
  return [
    `PATIENT CLERKING — ${reviewed ? "CLINICIAN REVIEW CONFIRMED" : "DRAFT: CLINICIAN REVIEW REQUIRED"}`,
    "Patient-reported history; examination requires a clinician.",
    ...draft.sections.map((s) => `${s.heading}\n${s.text}`),
    `Clinician examination findings\n${draft.clinicianFindings || "Not obtained."}`,
    ...(draft.clarifications.length
      ? [
          "Points to clarify\n" +
            draft.clarifications.map((c) => `• ${c.question} (${c.reason})`).join("\n"),
        ]
      : []),
  ].join("\n\n");
}
