// School identity: turning a free-text box into something you can group by.
//
// `user_profiles.university` is a text box a student typed once during
// onboarding and can edit in Settings. This is the real production
// distribution, read out of Supabase on 2026-08-18 rather than imagined:
//
//     Veritas          "Veritas"  "Veritas University "  "veritas university"
//                      "Veritas University Abuja"  "Veritas University Bwari"
//                      "VUNA"  "Vua"  "VERITAS UNIVERSITY ABUJA "
//                      "Veritas university, college of medicine, medicine and surgery"
//                      "Medicine and surgery,  veritas university "
//                      " Veritas university, 200level"
//     Not a school     "University " x14  "University" x7  "university" x3
//                      "School"  "College"  "No school"  "Medicine and surgery"
//                      "Law"  "Software engineering "  "bs"
//
// Every spelling on the first block is one institution. Nothing in the second
// block is an institution at all, and that half matters more: 24 people typed
// some form of bare "University", and a matcher that hands them a key puts two
// dozen strangers on one nonsense leaderboard together.
//
// THE LINE THIS FILE WILL NOT CROSS
// --------------------------------
// There is no fuzzy matching here. No edit distance, no similarity threshold,
// no "did you mean". A matcher loose enough to merge `Unilag` into `University
// of Lagos` is also loose enough to merge `LASU` into `UNILAG`, and the failure
// mode is not cosmetic - it puts a student on the leaderboard of a school they
// do not attend. String distance does not encode institutional identity and no
// threshold will make it. Acronyms are collapsed by a CURATED table, one entry
// per real school, which is a fact somebody wrote down rather than a guess.
//
// THE ASYMMETRY THIS FILE IS BUILT AROUND
// ---------------------------------------
// The previous version stripped generic tails off the END of the string, so any
// trailing city or country blocked it entirely ("Veritas University Abuja" did
// not match "Veritas"). The fix is not a longer strip list, it is noticing that
// a place word means opposite things in the two shapes a school name takes:
//
//     <Name> University <Place>      "Veritas University Abuja"    place = noise
//     University of <Place>          "University of Ibadan"        place = identity
//
// So the token list is split at the FIRST institution word, and what happens to
// the tail depends entirely on whether the head already names something:
//
//     head distinctive     -> identity is the head, tail is noise    (Veritas)
//     head empty           -> identity is the tail                   (Ibadan)
//     head all modifiers   -> identity is head + tail                (FUT Minna)
//
// That third case is why "Federal University of Technology Minna" and "Federal
// university technology of Owerri" stay apart: "federal" names nothing, so the
// place is all the identity there is and must be kept.
//
// Everything above the fetch helper at the foot of the file is pure: no
// network, no Supabase, no React. That is deliberate - this is the part that
// has to be right, and pure functions are the part you can actually check.

import { supabase } from "@/integrations/supabase/client";

/**
 * Has supabase/migrations/20260818120000_school_and_week_leaderboards.sql
 * landed in the database this browser is talking to?
 *
 * This began as a hand-flipped `SCHOOL_LEADERBOARD_APPLIED = false`, the same
 * contract as FRIEND_SEARCH_PREFIX_APPLIED in src/lib/social.ts. That contract
 * is wrong for THIS case. Migrations here are applied by hand, so a constant
 * meant the owner could run the SQL and watch nothing change until a second,
 * separate code change shipped - and a school board that stays empty after you
 * did the work reads as a broken feature, not a pending one.
 *
 * So it is detected instead. The first call simply tries the RPC. PostgREST
 * answers a missing function with PGRST202, which latches this flag for the
 * rest of the session; every other failure (a network blip, a timeout) must NOT
 * latch, or one bad moment would hide the board until a reload. The probe is
 * safe because every failure path here already returns null: the cost of
 * guessing wrong is one wasted request, not a broken page.
 *
 * WHY A MIGRATION WAS UNAVOIDABLE, since the standing preference is to build
 * from data the client can already read: it cannot. `user_profiles` RLS is
 * strictly own-row ("Users view own profile", 20260425233320) and nothing has
 * widened it since - deliberately, because the row carries `university`,
 * `year`, `discipline` and `personalization_background`. Neither applied
 * leaderboard RPC exposes an institution: `leaderboard_top` returns
 * (user_id, name, points, current_streak, rank) and `leaderboard_rank` returns
 * (rank, total). So a client can read exactly one student's school - its own -
 * and a board of one is not a board.
 */
let schoolRpcMissing = false;

/**
 * Did this error mean "that function is not in the database", as opposed to
 * "the request failed"? Only the former should stop us trying again.
 */
function isMissingFunction(error: unknown): boolean {
  const e = error as { code?: string | null; message?: string | null } | null;
  if (!e) return false;
  if (e.code === "PGRST202") return true;
  return /could not find the function|does not exist/i.test(e.message ?? "");
}

// ── Word sets ───────────────────────────────────────────────────────────────
//
// Curated, not generated. Each set answers one question about a single token
// and the pipeline below decides what that answer means depending on where the
// token sits, so a word never has to be "mostly" noise or "mostly" identity.

/** Words that say what KIND of institution this is, mapped to their family. */
const INSTITUTION_WORDS = new Map<string, string>([
  ["university", "university"],
  ["universities", "university"],
  ["univeristy", "university"], // the one misspelling common enough to matter
  ["univerity", "university"],
  ["univ", "university"],
  ["uni", "university"],
  ["varsity", "university"],
  ["polytechnic", "polytechnic"],
  ["poly", "polytechnic"],
  ["college", "college"],
  ["institute", "institute"],
  ["institution", "institute"],
  ["academy", "academy"],
  ["school", "school"],
  ["seminary", "seminary"],
]);

/** The family a name with no institution word at all is filed under. */
const DEFAULT_FAMILY = "university";

/** Joining words. Carry no identity anywhere, in any position. */
const STOPWORDS = new Set(["of", "the", "and", "at", "in", "for", "de", "du", "a", "an"]);

/**
 * Answers that are not a school: refusals, filler, and the level suffixes
 * students append ("200level", "300 level", "2nd year").
 */
const JUNK_WORDS = new Set([
  "no",
  "none",
  "nil",
  "na",
  "nan",
  "nothing",
  "nowhere",
  "unknown",
  "undecided",
  "student",
  "students",
  "aspirant",
  "aspiring",
  "undergraduate",
  "undergrad",
  "graduate",
  "level",
  "levels",
  "year",
  "yr",
  "yrs",
  "semester",
  "currently",
  "studying",
  "study",
  "tbd",
  "dept",
  "department",
  "faculty",
]);

/**
 * Descriptors that qualify an institution without naming one. "Federal
 * University" and "State University" are not schools; "Federal University of
 * Technology Minna" is, and the part that makes it one is "Minna".
 */
const MODIFIER_WORDS = new Set([
  "federal",
  "state",
  "national",
  "international",
  "government",
  "private",
  "public",
  "open",
  "central",
  "regional",
  "secondary",
  "primary",
  "technical",
  "community",
  "city",
  "general",
  "higher",
  "advanced",
  "new",
  "first",
  "royal",
  "grammar",
  "comprehensive",
]);

/**
 * Courses, degrees and faculties. Students answer "where do you study" with
 * "Medicine and surgery" often enough that this is the second biggest cluster
 * in the data after Veritas, and it must resolve to no school rather than to a
 * medicine leaderboard.
 */
const COURSE_WORDS = new Set([
  "medicine",
  "medical",
  "surgery",
  "surgical",
  "nursing",
  "nurse",
  "midwifery",
  "law",
  "legal",
  "pharmacy",
  "pharmaceutical",
  "pharmacology",
  "engineering",
  "biomedical",
  "anatomy",
  "physiology",
  "dentistry",
  "dental",
  "radiography",
  "physiotherapy",
  "optometry",
  "biochemistry",
  "microbiology",
  "psychology",
  "sociology",
  "economics",
  "accounting",
  "accountancy",
  "finance",
  "marketing",
  "management",
  "administration",
  "business",
  "computer",
  "computing",
  "software",
  "cyber",
  "relations",
  "diplomacy",
  "journalism",
  "communication",
  "communications",
  "architecture",
  "agriculture",
  "veterinary",
  "statistics",
  "mathematics",
  "maths",
  "physics",
  "chemistry",
  "biology",
  "botany",
  "zoology",
  "geology",
  "geography",
  "philosophy",
  "theology",
  "linguistics",
  "literature",
  "education",
  "mbbs",
  "mbchb",
  "bsc",
  "msc",
  "phd",
  "llb",
  "bs",
  "ba",
]);

/**
 * Nigerian states, cities and campus towns, plus the handful of foreign places
 * that appear in the data.
 *
 * Used in exactly ONE position: after the institution word, in a name whose
 * head already identifies the school. "Veritas University Abuja" and "Veritas
 * University Bwari" are the same school on two campuses; "University of Abuja"
 * is a different school entirely, and it never reaches this set because its
 * head is empty.
 *
 * A place missing from this list costs a split, not a wrong merge - the two
 * spellings simply do not collapse. That is the safe direction to fail in, and
 * it is why adding entries here is a low-risk edit.
 */
const PLACE_WORDS = new Set([
  // FCT and the north central
  "abuja",
  "bwari",
  "gwagwalada",
  "kubwa",
  "kuje",
  "lugbe",
  "nyanya",
  "karu",
  "nasarawa",
  "lafia",
  "keffi",
  "niger",
  "minna",
  "bida",
  "suleja",
  "lapai",
  "kogi",
  "lokoja",
  "anyigba",
  "ayingba",
  "kwara",
  "ilorin",
  "offa",
  "benue",
  "makurdi",
  "otukpo",
  "plateau",
  "jos",
  "bukuru",
  // South west
  "lagos",
  "akoka",
  "yaba",
  "ikeja",
  "epe",
  "ojo",
  "badagry",
  "ikorodu",
  "surulere",
  "ogun",
  "ota",
  "abeokuta",
  "ijebu",
  "ilishan",
  "remo",
  "sagamu",
  "oyo",
  "ibadan",
  "ogbomoso",
  "iseyin",
  "osun",
  "osogbo",
  "ilesa",
  "ede",
  "ife",
  "ile",
  "ondo",
  "akure",
  "owo",
  "ekiti",
  "ado",
  "iworoko",
  // South south
  "edo",
  "benin",
  "ekpoma",
  "auchi",
  "okada",
  "delta",
  "asaba",
  "warri",
  "abraka",
  "oghara",
  "rivers",
  "harcourt",
  "port",
  "portharcourt",
  "bayelsa",
  "yenagoa",
  "amassoma",
  "cross",
  "river",
  "calabar",
  "ogoja",
  "akwa",
  "ibom",
  "uyo",
  "ikot",
  "ekpene",
  // South east
  "enugu",
  "nsukka",
  "agbani",
  "anambra",
  "awka",
  "onitsha",
  "nnewi",
  "igbariam",
  "uli",
  "imo",
  "owerri",
  "orlu",
  "okigwe",
  "abia",
  "umuahia",
  "aba",
  "uturu",
  "ebonyi",
  "abakaliki",
  "uburu",
  // North west and north east
  "kaduna",
  "zaria",
  "kafanchan",
  "kano",
  "wudil",
  "katsina",
  "dutsinma",
  "jigawa",
  "dutse",
  "sokoto",
  "kebbi",
  "birnin",
  "argungu",
  "zamfara",
  "gusau",
  "gombe",
  "bauchi",
  "azare",
  "borno",
  "maiduguri",
  "yobe",
  "damaturu",
  "potiskum",
  "adamawa",
  "yola",
  "mubi",
  "taraba",
  "jalingo",
  "wukari",
  // Countries and the foreign places that turn up
  "nigeria",
  "nigerian",
  "africa",
  "ghana",
  "accra",
  "kenya",
  "england",
  "london",
  "canada",
  "ontario",
  "toronto",
  "india",
  "egypt",
  "cairo",
]);

/**
 * Trailing country words. Dropped from the END of a finished key whenever
 * something else survives, so "Skyline University Nigeria" and "Skyline
 * University" agree - but "University of Nigeria" keeps its only token.
 */
const COUNTRY_WORDS = new Set(["nigeria", "nigerian", "naija", "ng", "africa"]);

/**
 * Acronyms and short names, each mapped to the key its full name produces.
 *
 * This is the only place two different strings are declared to be one school on
 * anything other than structure, so every line is a fact somebody checked. The
 * value on the right must be exactly what normalizeSchool() returns for the
 * spelled-out name - the tests at the foot of this comment block are the ones
 * in the acceptance list, and they pin each pair.
 *
 * Applied twice: once against a whole comma-segment ("VUNA", "Vua"), and once
 * against the finished key, so "Aspirant ( unilag)" lands on the same board as
 * "University of Lagos".
 */
const SCHOOL_ALIASES: Record<string, string> = {
  // Veritas University, Abuja. Both forms appear in production.
  vuna: "veritas",
  vua: "veritas",
  // University of <place>
  unilag: "lagos",
  uniben: "benin",
  unijos: "jos",
  uniabuja: "abuja",
  unical: "calabar",
  uniuyo: "uyo",
  uniport: "port harcourt",
  unilorin: "ilorin",
  uniilorin: "ilorin",
  unimaid: "maiduguri",
  unn: "nigeria",
  nsukka: "nigeria",
  // <Place> State University
  lasu: "lagos state",
  lasucom: "lagos state",
  imsu: "imo state",
  absu: "abia state",
  ebsu: "ebonyi state",
  delsu: "delta state",
  kwasu: "kwara state",
  // Named universities
  oau: "obafemi awolowo",
  abu: "ahmadu bello",
  unizik: "nnamdi azikiwe",
  buk: "bayero",
  atbu: "abubakar tafawa balewa",
  // Federal universities of technology - the place IS the identity here
  futo: "federal technology owerri",
  futminna: "federal technology minna",
  futmin: "federal technology minna",
  futa: "federal technology akure",
};

// ── Normalising ─────────────────────────────────────────────────────────────

/**
 * Lowercase, unaccent, de-punctuate, squeeze. The reversible-information part
 * of the rewrite: nothing removed here identifies an institution.
 *
 * Apostrophes are deleted rather than turned into a space, so that "St Mary's"
 * and "St Marys" land on the same string. Every other punctuation mark becomes
 * a space, so "Univ. of Lagos" and "Univ of Lagos" agree too.
 */
function flatten(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** A token that is filler, a refusal, or a level suffix ("200level", "2nd"). */
function isJunk(token: string): boolean {
  return JUNK_WORDS.has(token) || /\d/.test(token);
}

/** A token that could name a school on its own. Places count; descriptors do not. */
function isDistinctive(token: string): boolean {
  return (
    !STOPWORDS.has(token) &&
    !isJunk(token) &&
    !INSTITUTION_WORDS.has(token) &&
    !MODIFIER_WORDS.has(token) &&
    !COURSE_WORDS.has(token)
  );
}

/** Everything a place-name tail can be made of once the school is already named. */
function isTailNoise(token: string): boolean {
  return (
    STOPWORDS.has(token) ||
    isJunk(token) ||
    INSTITUTION_WORDS.has(token) ||
    MODIFIER_WORDS.has(token) ||
    COURSE_WORDS.has(token) ||
    PLACE_WORDS.has(token)
  );
}

/** Structural words that never survive into a key, wherever they sit. */
function isSkeleton(token: string): boolean {
  return STOPWORDS.has(token) || isJunk(token) || INSTITUTION_WORDS.has(token);
}

/** Drop a trailing "Nigeria" when the name has anything else left to stand on. */
function trimCountry(tokens: string[]): string[] {
  const out = [...tokens];
  while (out.length > 1 && COUNTRY_WORDS.has(out[out.length - 1])) out.pop();
  return out;
}

type SegmentKey = { stem: string; family: string; named: boolean };

/**
 * The key for ONE comma-segment, or null when the segment names no institution.
 *
 * `named` records whether an institution word was present, which is what lets
 * the caller prefer "veritas university" over "abuja" when a student typed
 * both.
 */
function keyForSegment(flat: string): SegmentKey | null {
  const tokens = flat.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  const pivot = tokens.findIndex((token) => INSTITUTION_WORDS.has(token));

  // ── No institution word at all: "Veritas", "Medicine and surgery", "bs" ──
  if (pivot === -1) {
    const kept = trimCountry(
      tokens.filter((token) => !isSkeleton(token) && !COURSE_WORDS.has(token)),
    );
    if (kept.length === 0) return null;
    // Descriptors with nothing to describe. "International Relations and
    // diplomacy" reduces to "international", which is not a school.
    if (kept.every((token) => MODIFIER_WORDS.has(token))) return null;
    // A lone two-letter fragment is a typo or an abbreviation nobody can
    // resolve ("bs"). Real short names reach here through SCHOOL_ALIASES.
    if (kept.length === 1 && kept[0].length < 3) return null;
    return { stem: kept.join(" "), family: DEFAULT_FAMILY, named: false };
  }

  const family = INSTITUTION_WORDS.get(tokens[pivot]) ?? DEFAULT_FAMILY;
  const head = tokens.slice(0, pivot).filter((token) => !isSkeleton(token));
  const tail = tokens.slice(pivot + 1);

  // ── "University of <Place>": the head is empty, so the tail IS the name ──
  if (head.length === 0) {
    const kept = trimCountry(
      tail.filter((token) => !isSkeleton(token) && !COURSE_WORDS.has(token)),
    );
    if (kept.length === 0) return null; // bare "University", "School", "No school"
    return { stem: kept.join(" "), family, named: true };
  }

  // ── "<Name> University <Place>": the head names it, the tail is noise ──
  if (head.some(isDistinctive)) {
    const kept = trimCountry([...head, ...tail.filter((token) => !isTailNoise(token))]);
    return { stem: kept.join(" "), family, named: true };
  }

  // ── "Federal University of Technology <Place>": the head describes but does
  //    not name, so the place is the only identity there is and it stays. ──
  const kept = trimCountry([...head, ...tail.filter((token) => !isSkeleton(token))]);
  if (kept.length === 0) return null;
  return { stem: kept.join(" "), family, named: true };
}

/** Resolve an acronym, once. Never chains, so the table cannot loop. */
function resolveAlias(stem: string): string {
  return SCHOOL_ALIASES[stem] ?? stem;
}

/**
 * The grouping key for one raw school string, or null when it names no school.
 *
 * Guarantees, in the order they matter:
 *
 *   * Every Veritas spelling in production - bare "Veritas", "VUNA", "Vua",
 *     "Veritas University Abuja", "Veritas University Bwari", the comma'd
 *     course junk and the "200level" suffix - returns "veritas".
 *   * "Nile Polytechnic" returns "nile:polytechnic" - same stem, different
 *     family, so the two schools never share a board.
 *   * "University of Ibadan", "University of Jos", "University of Abuja" and
 *     "University of Nigeria" stay four different keys, and "University of
 *     Lagos" never merges with "Lagos State University".
 *   * A string that names no institution returns NULL rather than a key:
 *     "University", "School", "College", "No school", "Medicine and surgery",
 *     "Law", "Software engineering", "bs". This is the guarantee the data most
 *     needs - 24 students typed some form of bare "University" and none of them
 *     may end up on a shared board because of it.
 *   * "" / "   " / null return null.
 *
 * The caller treats null as "unaffiliated", never as a group.
 */
export function normalizeSchool(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // Split before flattening: the punctuation is the only signal that "Veritas
  // university, college of medicine, medicine and surgery" is one school and
  // two course names rather than one long name.
  const segments = raw
    .split(/[,;/|()[\]]+/)
    .map(flatten)
    .filter(Boolean);
  if (segments.length === 0) return null;

  let best: { stem: string; family: string; tier: number } | null = null;
  for (const segment of segments) {
    let candidate: { stem: string; family: string; tier: number } | null = null;
    if (SCHOOL_ALIASES[segment]) {
      candidate = { stem: SCHOOL_ALIASES[segment], family: DEFAULT_FAMILY, tier: 0 };
    } else {
      const parsed = keyForSegment(segment);
      if (parsed) {
        candidate = { stem: parsed.stem, family: parsed.family, tier: parsed.named ? 1 : 2 };
      }
    }
    // Lower tier wins; ties go to the leftmost segment, which is where a
    // student who typed both a school and a course usually put the school.
    if (candidate && (!best || candidate.tier < best.tier)) best = candidate;
  }
  if (!best) return null;

  const stem = resolveAlias(best.stem);
  if (!stem) return null;
  return best.family === DEFAULT_FAMILY ? stem : `${stem}:${best.family}`;
}

/**
 * The substrings the server should match a student's raw `university` text
 * against to find everyone who might be at the same school.
 *
 * DELIBERATELY A SUPERSET. The server does a cheap contains-any over these
 * terms; this module then re-normalises every row it gets back and keeps only
 * exact key matches. That keeps the matcher in ONE implementation - this file -
 * instead of a SQL mirror that drifts, and it means the server never has to
 * hand a client the whole student roster to group locally: you only ever see
 * rows whose text already contains a piece of your own school's name.
 *
 * Descriptor tokens ("federal", "state") are dropped so a term list is not
 * dominated by a word half the country's universities contain, unless dropping
 * them would leave nothing.
 */
export function schoolMatchTerms(raw: string | null | undefined): string[] {
  const key = normalizeSchool(raw);
  if (!key) return [];
  const stem = key.split(":")[0];
  const tokens = stem.split(" ").filter(Boolean);
  const terms = new Set<string>();
  for (const token of tokens) {
    if (token.length >= 3 && !MODIFIER_WORDS.has(token)) terms.add(token);
  }
  if (terms.size === 0) {
    for (const token of tokens) if (token.length >= 3) terms.add(token);
  }
  for (const [alias, target] of Object.entries(SCHOOL_ALIASES)) {
    if (target === stem) terms.add(alias);
  }
  return [...terms];
}

// ── Choosing what to call the school ────────────────────────────────────────

/** Trim, squeeze internal whitespace, drop trailing punctuation. Casing kept. */
function tidy(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:]+$/, "");
}

/**
 * Title-case a spelling nobody typed properly. Small joining words stay lower
 * unless they lead, which is what makes "university of lagos" read as
 * "University of Lagos" rather than "University Of Lagos".
 */
const SMALL_WORDS = new Set(["of", "and", "the", "for", "at", "in", "de", "du"]);
function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word, index) => {
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** An all-caps spelling with no space in it: UNILAG, LASU, VUNA. */
function looksLikeAcronym(value: string): boolean {
  return value === value.toUpperCase() && value !== value.toLowerCase() && !value.includes(" ");
}

/**
 * Given every raw spelling that collapsed onto one key, decide what to put on
 * screen as the school's name.
 *
 * The rules, and why each one is there:
 *
 *   1. Spellings that name no school at all are dropped first, so one student
 *      who typed "Medicine and surgery" alongside their university cannot name
 *      the board.
 *   2. One-off spellings are dropped as long as some spelling was typed more
 *      than once. This is the typo filter, and it has to come early: without
 *      it, one student's "Nile Universsity Abuja" outranks fifty clean "Nile
 *      University"s on every "most complete" measure there is.
 *   3. Among what survives, the MOST COMPLETE spelling wins - most words, then
 *      longest. "Nile University" beats "Nile", which is the point: the bare
 *      stem is the thing being canonicalised away, not the thing to display.
 *   4. Frequency breaks ties, then alphabetical order so the answer is stable
 *      across renders and does not depend on the order rows arrived in.
 *
 * Casing is decided inside the winning spelling's own group, and the ORDER of
 * those three rules is the fix for a real bug: the acronym test now runs first.
 * It used to run last, so schoolDisplayName(["UNILAG","UNILAG","Unilag"])
 * returned "Unilag" - a single stray mixed-case spelling beat two verbatim
 * ones and vandalised an acronym the function's own contract says to leave
 * alone. The most-typed spelling is chosen first; if that is an all-caps
 * no-space acronym it is returned exactly as typed, and only otherwise does a
 * human's mixed-case capitalisation win over title-casing.
 *
 * Returns null when there is nothing usable, so the caller decides what an
 * unnamed school looks like.
 */
export function schoolDisplayName(raws: ReadonlyArray<string | null | undefined>): string | null {
  const groups = new Map<string, { spellings: Map<string, number>; count: number }>();

  for (const raw of raws) {
    if (!raw) continue;
    const spelling = tidy(raw);
    if (!spelling) continue;
    if (!normalizeSchool(spelling)) continue;
    const key = spelling.toLowerCase();
    const group = groups.get(key) ?? { spellings: new Map<string, number>(), count: 0 };
    group.count += 1;
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
    groups.set(key, group);
  }
  if (groups.size === 0) return null;

  const entries = [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  const hasRepeat = entries.some((entry) => entry.count > 1);
  const candidates = hasRepeat ? entries.filter((entry) => entry.count > 1) : entries;

  candidates.sort((a, b) => {
    const words = b.key.split(" ").length - a.key.split(" ").length;
    if (words !== 0) return words;
    if (b.key.length !== a.key.length) return b.key.length - a.key.length;
    if (b.count !== a.count) return b.count - a.count;
    return a.key.localeCompare(b.key);
  });

  const winner = candidates[0];
  const spellings = [...winner.spellings.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const typed = spellings[0][0];
  // An acronym is not a badly-cased word. Left exactly as it was typed.
  if (looksLikeAcronym(typed)) return typed;
  const mixedCase = spellings.find(([s]) => s !== s.toLowerCase() && s !== s.toUpperCase());
  if (mixedCase) return mixedCase[0];
  return titleCase(typed.toLowerCase());
}

/**
 * The school name to show for a single student - the everyday case, where the
 * only spelling in hand is the one they typed themselves. Null when what they
 * typed names no school, which is the signal to offer Settings instead.
 */
export function ownSchoolName(raw: string | null | undefined): string | null {
  return schoolDisplayName([raw]);
}

// ── The board ───────────────────────────────────────────────────────────────

export type SchoolBoardRow = {
  user_id: string;
  name: string;
  points: number;
  current_streak: number;
  rank: number;
  /** The raw spelling this student typed, used to pick the display name. */
  university: string | null;
};

export type SchoolBoard = {
  /** The key every row on this board shares. */
  key: string;
  /** The name chosen from every spelling on the board. */
  name: string | null;
  rows: SchoolBoardRow[];
  /** How many students at this school are ranked at all. */
  cohort: number;
};

type RpcResult = { data: unknown; error: { message: string } | null };
type SchoolDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };

type SchoolCandidate = {
  user_id: string;
  name: string;
  points: number;
  current_streak: number;
  university: string | null;
};

/**
 * Standings for everyone at one student's school.
 *
 * Returns null - not an empty board - when the feature cannot answer, which is
 * every case the caller has to render differently: the student's text names no
 * school, the migration is not applied yet, or the call failed.
 *
 * The server returns a SUPERSET (every ranked student whose university text
 * contains one of the caller's match terms) and the exact grouping happens
 * here, against normalizeSchool. That is the whole reason there is no SQL
 * mirror of the matcher to keep in step.
 *
 * Never throws. A leaderboard tab failing is not a reason to break a page.
 */
export async function fetchSchoolBoard(
  university: string | null | undefined,
  limit = 200,
): Promise<SchoolBoard | null> {
  const key = normalizeSchool(university);
  if (!key) return null;
  if (schoolRpcMissing) return null;

  const terms = schoolMatchTerms(university);
  if (terms.length === 0) return null;

  try {
    const db = supabase as unknown as SchoolDb;
    const { data, error } = await db.rpc("leaderboard_school", {
      p_terms: terms,
      limit_count: limit,
    });
    if (error) {
      if (isMissingFunction(error)) schoolRpcMissing = true;
      return null;
    }

    const candidates = (data as SchoolCandidate[] | null) ?? [];
    const mine = candidates.filter((row) => normalizeSchool(row.university) === key);
    mine.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    const rows: SchoolBoardRow[] = mine.map((row, index) => ({
      user_id: row.user_id,
      name: row.name,
      points: row.points,
      current_streak: row.current_streak,
      rank: index + 1,
      university: row.university,
    }));

    return {
      key,
      name: schoolDisplayName(rows.map((row) => row.university)) ?? ownSchoolName(university),
      rows,
      cohort: rows.length,
    };
  } catch {
    return null;
  }
}
