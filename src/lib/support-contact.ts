// One place for the owner's contact details, so a phone number typed twice
// cannot go stale in one place and not the other. Currently used only by the
// out-of-cookies dialog (src/components/cookie-empty-dialog.tsx), but kept
// separate from cookies.ts on purpose: this is who to contact, not what
// cookies cost, and a future surface that needs the same number should not
// have to import the whole cookies module to get it.

export const OWNER_PHONE_LOCAL = "08105535057";
export const OWNER_PHONE_E164 = "+2348105535057";

export const OWNER_CALL_HREF = `tel:${OWNER_PHONE_E164}`;

/**
 * The WhatsApp deep link, prefilled with the student's own handle so the
 * owner knows who is asking without a back-and-forth first. `handle` is
 * whatever the caller already has to name the student with - a @username, a
 * display name, or the fallback below if neither is available.
 */
export function ownerWhatsAppHref(handle: string | null | undefined): string {
  const who = (handle ?? "").trim() || "a student";
  const text = `Hi G&D, I'm out of cookies for today (${who}). Can I get more?`;
  return `https://wa.me/2348105535057?text=${encodeURIComponent(text)}`;
}
