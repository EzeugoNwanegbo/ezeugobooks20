// Bulk-ingest a folder of textbooks into the shared library.
//
// The in-app path (Library upload -> Admin -> Add a textbook) processes one book
// at a time in a browser tab that has to stay open. That is fine for a student
// sharing one file and hopeless for a compiled textbook folder, so this script
// does the same work from disk: extract -> chunk -> embed -> insert.
//
// It deliberately reuses the app's own chunker (src/lib/document-chunks.ts) via
// Node type-stripping rather than reimplementing it. Library chunks and user
// chunks are searched by the same hybrid RPC and blended into one ranking, so if
// the two chunkers ever drifted apart the ranking would quietly skew.
//
// Usage:
//   node --experimental-strip-types scripts/ingest-library.mjs "<folder>" [opts]
//
//   --discipline <name>   medicine | law | all      (default: medicine)
//   --track <name>        e.g. "Pre-clinical"       (default: Pre-clinical)
//   --status <status>     approved | pending        (default: approved)
//   --dry-run             scan, dedupe and report; touch nothing remote
//   --limit <n>           stop after n books (handy for a first trial run)
//   --only <a,b,c>        only files whose path contains one of these terms
//                         (case-insensitive; repeatable, comma-separated) —
//                         how you cherry-pick from a mixed folder
//   --keep-near-dupes     ingest same-title/same-page-count books instead of skipping
//   --force               re-ingest even if the hash is already in the library
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env). The service
// role key is needed because library_document_chunks is admin-write and the
// script authenticates as no one.

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, extname, basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { chunkDocumentText, sanitizeExtractedText } from "../src/lib/document-chunks.ts";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const require = createRequire(pathToFileURL(join(PROJECT_ROOT, "package.json")).href);

// pdfjs 3.x probes for the optional native `canvas` package as it loads and
// warns loudly when it is missing. We only ever extract text — nothing renders —
// so the warning is pure noise.
const originalWarn = console.warn;
console.warn = () => {};
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
console.warn = originalWarn;

// pdfjs needs these for non-Latin glyphs and embedded font metrics. Point at the
// local install so the script works offline (the browser build uses a CDN).
const STANDARD_FONT_URL = pathToFileURL(
  join(PROJECT_ROOT, "node_modules/pdfjs-dist/standard_fonts/"),
).href;
const CMAP_URL = pathToFileURL(join(PROJECT_ROOT, "node_modules/pdfjs-dist/cmaps/")).href;

const STATE_FILE = join(PROJECT_ROOT, ".library-ingest-state.json");
// The embed edge function batches internally at 96; match it so one HTTP call
// maps to one OpenAI call.
const EMBED_BATCH = 96;
// PostgREST starts to struggle with very large bodies once each row carries a
// 1536-float vector. The app inserts 200 at a time, but the app is writing one
// student's file; a 1,964-page textbook made 200-row statements big enough to
// trip Postgres's statement timeout ("canceling statement due to statement
// timeout") partway through. 50 keeps each statement comfortably inside it.
const INSERT_BATCH = 50;
// A timeout is about the size of THIS statement, not the data, so halving the
// batch and retrying clears it where a blind retry would just fail again.
const INSERT_RETRIES = 3;
// Below this many characters per page the text layer is too sparse to be worth
// indexing - the book needs OCR, which this script does not do (see README note
// at the bottom of the run summary).
const MIN_CHARS_PER_PAGE = 120;

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    discipline: "medicine",
    track: "Pre-clinical",
    status: "approved",
    dryRun: false,
    limit: Infinity,
    // Repeatable, and comma-separated within one flag. A mixed folder often
    // holds a handful of wanted books among many unwanted ones, and re-scanning
    // (and re-hashing) gigabytes once per title is wasteful.
    only: [],
    keepNearDupes: false,
    force: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--keep-near-dupes") opts.keepNearDupes = true;
    else if (a === "--force") opts.force = true;
    else if (a === "--discipline") opts.discipline = argv[++i];
    else if (a === "--track") opts.track = argv[++i];
    else if (a === "--status") opts.status = argv[++i];
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--only") {
      for (const part of argv[++i].split(",")) {
        const term = part.trim().toLowerCase();
        if (term) opts.only.push(term);
      }
    } else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else positional.push(a);
  }
  opts.folder = positional[0];
  // 'all' means "no discipline" - the schema treats a null discipline as shared
  // with every student regardless of what they study.
  if (opts.discipline === "all") opts.discipline = null;
  return opts;
}

// ── env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(PROJECT_ROOT, ".env");
  const fromFile = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      fromFile[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  const pick = (...names) => {
    for (const n of names) {
      const v = process.env[n] ?? fromFile[n];
      if (v) return v;
    }
    return null;
  };
  return {
    url: pick("SUPABASE_URL", "VITE_SUPABASE_URL"),
    serviceKey: pick("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"),
  };
}

// ── title / metadata cleanup ────────────────────────────────────────────────
// Filenames in a compiled folder carry the fingerprints of wherever they were
// downloaded from. Strip that before it becomes the title students see.
const FILENAME_NOISE = [
  /\[[^\]]*\]/g, // [Medicalstudyzone.com]
  /\(\s*pdfdrive\.com\s*\)/gi,
  /-?\s*libgen\.(li|rs|is)/gi,
  /emedicodiary/gi,
  /medicalstudyzone/gi,
  /filename=\S*/gi,
  /-\d+hlm/gi, // "-313hlm" (page-count suffix from an Indonesian mirror)
  /\bPDF\b/g,
  /\s*\(\d+\)\s*/g, // trailing " (1)" from duplicate downloads
  /_+/g,
];

// Looks like an author segment rather than a title: "Susan Standring",
// "Lynn B. Jorde PhD, John C. Carey MD MPH", "K Sembulingam", or a bare "3".
// Requiring every word to be capitalised (or an initial/degree/number) is what
// keeps real titles safe — "Textbook of Medical Physiology" has a lowercase
// "of" and so is never mistaken for a name.
const DEGREES = /^(phd|md|mph|mbbs|dsc|frcs|jr|sr|ii|iii)$/i;
function looksLikeAuthors(segment) {
  const words = segment.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  // Three-author medical textbooks run long: "Keith L. Moore, T. V. N.
  // Persaud, Mark G. Torchia" is 10 words, and adding degrees pushes it to 13.
  if (words.length === 0 || words.length > 14) return false;
  if (words.every((w) => /^\d+$/.test(w))) return true; // "3 - Textbook of..."
  return words.every(
    (w) =>
      /^[A-Z]{1,3}\.?$/.test(w) || // initials, incl. run-together "DM"
      /^[A-Z][a-z’'-]+\.?$/.test(w) ||
      DEGREES.test(w),
  );
}

function cleanTitle(raw) {
  let t = raw;
  for (const re of FILENAME_NOISE) t = t.replace(re, " ");
  // Publisher/year parentheticals: "(2015, Saunders)", "(2021, Elsevier)".
  t = t.replace(/\(\s*(19|20)\d{2}\s*,[^)]*\)/g, " ");
  // Strip every .pdf, not just a trailing one — names like
  // "…14th Edition.pdf filename=UT (1)(1).pdf" carry two.
  t = t.replace(/\.pdf\b/gi, " ");
  t = t
    .replace(/[_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Drop a leading author segment: "Susan Standring - Gray's anatomy - …".
  const parts = t.split(/\s+-\s+/);
  if (parts.length >= 2 && looksLikeAuthors(parts[0])) {
    t = parts.slice(1).join(" - ");
  }

  // Slug-style names ("lasts-anatomy-12th") have no spaces to work with.
  if (!/\s/.test(t) && t.includes("-")) {
    t = t
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  // Filenames routinely lose the apostrophe: "Junqueira s Basic Histology".
  t = t.replace(/\b([A-Z][a-z]{2,})\s+s\b/g, "$1's");
  t = t.replace(/\bEdt\b/g, "Edition");
  // "…, 14th Edition II" — a trailing roman numeral is a duplicate-download
  // marker, not part of the edition.
  t = t.replace(/\b(Edition)\s+I{1,3}\s*$/i, "$1");

  return t
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,-]+|[\s,-]+$/g, "")
    .trim();
}

// Prefer the PDF's own Title only when it looks like a real title rather than a
// filename echo or a stub ("A practical medical dictionary ..").
// Curly vs straight quotes differ between PDF metadata and filenames often
// enough to break a naive substring test ("Moore’s" vs "Moore's"), which would
// then throw away the edition number the filename carries.
const flatten = (s) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();

function chooseTitle(metaTitle, fileName) {
  const fromFile = cleanTitle(fileName);
  // Metadata titles carry their own junk — scanner tools like to append a page
  // count, e.g. "A Guide to Dissection of the Human Body (2nd Edition) (434 pages)".
  const meta = (metaTitle || "")
    .replace(/\(\s*\d+\s*pages?\s*\)/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!meta) return fromFile;
  if (meta.length < 10) return fromFile;
  if (/\.pdf$/i.test(meta)) return fromFile;
  if (/^untitled|^microsoft word|^document\d*$/i.test(meta)) return fromFile;
  // A metadata title already contained in the filename adds nothing, and the
  // filename usually carries the edition too — prefer it.
  if (flatten(fromFile).includes(flatten(meta))) return fromFile;
  return meta;
}

// "ANATOMY" -> "Anatomy", "FOR DISSECTION" -> "For Dissection"
function subjectFromFolder(dir, root) {
  if (resolve(dir) === resolve(root)) return null;
  return basename(dir)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Near-duplicate detection.
//
// A prefix key does not work here: the same book can appear as "The Developing
// Human Clinically Oriented" and as "Keith L. Moore, … - The Developing Human_
// Clinically Oriented Embryology", which diverge at character one. Instead
// compare significant word sets by *containment* (intersection over the smaller
// set), so a title that is wholly contained in a longer one scores 1.0.
//
// Containment alone is too eager — Cunningham Volume 1 and Volume 2 overlap
// heavily — so callers pair it with an equal-page-count check. Page count is the
// strong signal; the title test just prevents coincidental collisions.
const STOP_WORDS = new Set(["the", "of", "and", "a", "an", "for", "with", "to", "in", "on"]);

function titleTokens(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );
}

function containment(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

const NEAR_DUPE_THRESHOLD = 0.75;

// ── file walking + hashing ──────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (extname(name).toLowerCase() === ".pdf") out.push(full);
  }
  return out;
}

function hashFile(path) {
  // Books here top out around 300 MB; a single read is simpler than streaming
  // and the buffer is reused for parsing immediately afterwards.
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// ── extraction ──────────────────────────────────────────────────────────────
// Mirrors src/lib/pdf.ts exactly: items joined with a space, each page prefixed
// "\n\n[Page N]\n". chunkDocumentText() parses those markers to attach page
// numbers to chunks, so any deviation here silently loses page citations.
async function extractPdf(buffer, onPage) {
  const doc = await pdfjs.getDocument({
    data: buffer,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: STANDARD_FONT_URL,
    isEvalSupported: false,
    password: "",
    verbosity: 0,
  }).promise;

  const pageCount = doc.numPages;
  const parts = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .join(" ");
    parts.push(`\n\n[Page ${i}]\n${pageText}`);
    // Without this pdfjs retains every parsed page and a 2400-page book climbs
    // into multi-GB territory.
    page.cleanup();
    if (i % 50 === 0 || i === pageCount) onPage?.(i, pageCount);
  }
  await doc.destroy();
  return { text: parts.join(""), pageCount };
}

// ── embedding ───────────────────────────────────────────────────────────────
async function embedTexts(env, texts) {
  const res = await fetch(`${env.url}/functions/v1/embed`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.serviceKey}`,
      apikey: env.serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (!Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
    throw new Error("embed returned unexpected shape");
  }
  return json.embeddings;
}

// ── chunk insert ────────────────────────────────────────────────────────────
/**
 * Insert a batch of chunks, halving and recursing on a statement timeout.
 *
 * The failure mode this exists for is size-dependent, not transient: a big
 * enough book makes each INSERT slow enough that Postgres cancels it, and the
 * same batch would fail again however many times it is retried. Splitting is
 * what actually fixes it, so a timeout halves the batch instead of sleeping.
 */
async function insertChunksWithRetry(supabase, rows, attempt = 0) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("library_document_chunks").insert(rows);
  if (!error) return;

  const timedOut = /statement timeout|canceling statement/i.test(error.message);
  if (timedOut && rows.length > 1 && attempt < INSERT_RETRIES) {
    const mid = Math.ceil(rows.length / 2);
    await insertChunksWithRetry(supabase, rows.slice(0, mid), attempt + 1);
    await insertChunksWithRetry(supabase, rows.slice(mid), attempt + 1);
    return;
  }
  throw new Error(`insert chunks: ${error.message}`);
}

// ── state ───────────────────────────────────────────────────────────────────
function loadState() {
  if (!existsSync(STATE_FILE)) return { books: {} };
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { books: {} };
  }
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const fmt = (n) => n.toLocaleString("en-US");

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.folder) {
    console.error(
      "Usage: node --experimental-strip-types scripts/ingest-library.mjs <folder> [--dry-run]",
    );
    process.exit(1);
  }
  if (!existsSync(opts.folder)) {
    console.error(`Folder not found: ${opts.folder}`);
    process.exit(1);
  }

  const env = loadEnv();
  if (!opts.dryRun && (!env.url || !env.serviceKey)) {
    console.error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Add SUPABASE_SERVICE_ROLE_KEY to .env (it is gitignored), or pass --dry-run to scan only.",
    );
    process.exit(1);
  }

  const supabase = opts.dryRun
    ? null
    : createClient(env.url, env.serviceKey, { auth: { persistSession: false } });

  // ── scan ──
  let files = walk(opts.folder).sort();
  if (opts.only.length) {
    files = files.filter((f) => {
      const lower = f.toLowerCase();
      return opts.only.some((term) => lower.includes(term));
    });
  }
  console.log(`\nScanning ${opts.folder}`);
  console.log(`Found ${files.length} PDFs\n`);

  const state = loadState();
  const seenHash = new Map();
  const plan = [];
  const skipped = [];

  for (const file of files) {
    const size = statSync(file).size;
    const name = basename(file);
    const subject = subjectFromFolder(dirname(file), opts.folder);
    const hash = hashFile(file);

    if (seenHash.has(hash)) {
      skipped.push({ name, why: `exact duplicate of ${basename(seenHash.get(hash))}` });
      continue;
    }
    seenHash.set(hash, file);

    if (state.books[hash]?.status === "done" && !opts.force) {
      skipped.push({ name, why: "already ingested (state file)" });
      continue;
    }
    plan.push({ file, name, size, subject, hash, title: cleanTitle(name) });
  }

  // ── near-duplicate candidates ──
  // Page counts aren't known until each file is opened, so this pass is only
  // advisory: it reports title-similar pairs. The actual skip decision happens
  // during ingest, once both page counts are in hand.
  for (const item of plan) item.tokens = titleTokens(item.title);
  const nearPairs = [];
  for (let i = 0; i < plan.length; i++) {
    for (let j = i + 1; j < plan.length; j++) {
      if (containment(plan[i].tokens, plan[j].tokens) >= NEAR_DUPE_THRESHOLD) {
        nearPairs.push([plan[i], plan[j]]);
      }
    }
  }

  console.log("Plan:");
  for (const item of plan) {
    console.log(
      `  ${(item.subject ?? "-").padEnd(12)} ${String(Math.round(item.size / 1024 / 1024)).padStart(4)} MB  ${item.title.slice(0, 62)}`,
    );
  }
  if (skipped.length) {
    console.log("\nSkipped:");
    for (const s of skipped) console.log(`  ${s.name.slice(0, 58)} — ${s.why}`);
  }
  if (nearPairs.length) {
    console.log("\nSimilar titles (skipped only if the page counts also match):");
    for (const [a, b] of nearPairs) {
      console.log(`  ~ ${a.title.slice(0, 52)}`);
      console.log(`    ${b.title.slice(0, 52)}`);
    }
    if (opts.keepNearDupes) console.log("  -> --keep-near-dupes set: both will be ingested.");
  }

  if (opts.dryRun) {
    console.log(`\nDry run — nothing written. ${plan.length} book(s) would be ingested.`);
    return;
  }

  // ── ingest ──
  let done = 0;
  let totalChunks = 0;
  const needsOcr = [];
  const failed = [];

  // Seed near-duplicate detection with what the library already holds. Books
  // added through the Admin UI before this script existed carry no content_hash,
  // so the hash check cannot see them — without this, re-importing a folder that
  // overlaps the existing library silently doubles those books. Their titles are
  // raw filenames, so clean them the same way before comparing.
  // content_hash is an optimisation, not a requirement: it makes re-runs
  // idempotent server-side even if the local state file is lost. When the
  // migration that adds it hasn't been applied, fall back to the state file
  // plus the title/page-count dedupe below rather than refusing to run.
  const { error: hashProbe } = await supabase
    .from("library_documents")
    .select("content_hash")
    .limit(1);
  const hasContentHash = !hashProbe;
  if (!hasContentHash) {
    console.log(
      "NOTE: library_documents.content_hash is missing (migration 20260803120000 not applied).\n" +
        "      Falling back to local state + title/page dedupe. Re-runs are still safe on this\n" +
        "      machine; they would only duplicate if .library-ingest-state.json were deleted.\n",
    );
  }

  const ingested = [];
  {
    const { data: existing, error } = await supabase
      .from("library_documents")
      .select("title, page_count");
    if (error) throw new Error(`read library_documents: ${error.message}`);
    for (const row of existing ?? []) {
      ingested.push({
        title: row.title,
        pageCount: row.page_count,
        tokens: titleTokens(cleanTitle(row.title)),
      });
    }
    if (ingested.length) {
      console.log(`Library already holds ${ingested.length} book(s); they will be skipped.`);
    }
  }

  for (const item of plan) {
    if (done >= opts.limit) break;
    const label = item.title.slice(0, 48);
    process.stdout.write(`\n[${done + 1}/${Math.min(plan.length, opts.limit)}] ${label}\n`);

    try {
      // Server-side idempotency: a hash already in the library means a previous
      // run inserted it even if the local state file was lost.
      if (!opts.force && hasContentHash) {
        const { data: existing } = await supabase
          .from("library_documents")
          .select("id")
          .eq("content_hash", item.hash)
          .maybeSingle();
        if (existing) {
          console.log("      already in library (hash match) — skipping");
          state.books[item.hash] = { status: "done", id: existing.id, title: item.title };
          saveState(state);
          continue;
        }
      }

      const buffer = new Uint8Array(readFileSync(item.file));
      let meta = null;
      const { text, pageCount } = await extractPdf(buffer, (p, total) => {
        process.stdout.write(`\r      reading ${p}/${total} pages`);
      });
      process.stdout.write("\r" + " ".repeat(40) + "\r");

      const clean = sanitizeExtractedText(text.replace(/\[Page \d+\]/g, " "));
      const perPage = Math.round(clean.length / Math.max(pageCount, 1));
      if (perPage < MIN_CHARS_PER_PAGE) {
        needsOcr.push({ name: item.name, perPage, pageCount });
        console.log(`      no usable text layer (${perPage} ch/pg) — needs OCR, skipping`);
        continue;
      }

      // Near-duplicate resolution: a similar title AND an identical page count
      // means the same book at a different scan quality. Page count is what
      // separates a true duplicate from Volume 1 vs Volume 2.
      if (!opts.keepNearDupes) {
        const twin = ingested.find(
          (p) =>
            p.pageCount === pageCount && containment(p.tokens, item.tokens) >= NEAR_DUPE_THRESHOLD,
        );
        if (twin) {
          console.log(
            `      near-duplicate of "${twin.title.slice(0, 40)}" (both ${fmt(pageCount)}p) — skipping`,
          );
          skipped.push({ name: item.name, why: `near-duplicate of ${twin.title}` });
          continue;
        }
      }

      // Title from PDF metadata where it beats the filename.
      try {
        const doc = await pdfjs.getDocument({ data: buffer, verbosity: 0 }).promise;
        meta = await doc.getMetadata();
        await doc.destroy();
      } catch {
        // metadata is a nicety; the cleaned filename is a fine fallback
      }
      const title = chooseTitle(meta?.info?.Title, item.name);

      const chunks = chunkDocumentText(text);
      console.log(
        `      ${fmt(pageCount)} pages · ${fmt(clean.length)} chars · ${fmt(chunks.length)} chunks`,
      );

      // Insert the catalog row first so a crash mid-embed leaves a row we can
      // find and clean up rather than orphaned chunks.
      const { data: libDoc, error: docErr } = await supabase
        .from("library_documents")
        .insert({
          title,
          file_name: item.name,
          file_type: "application/pdf",
          file_size: item.size,
          page_count: pageCount,
          discipline: opts.discipline,
          subject: item.subject,
          track: opts.track,
          status: opts.status,
          ...(hasContentHash ? { content_hash: item.hash } : {}),
          rights_note: `Bulk-imported from ${basename(opts.folder)} on ${new Date().toISOString().slice(0, 10)}`,
        })
        .select("id")
        .single();
      if (docErr) throw new Error(`insert library_documents: ${docErr.message}`);

      // Embed + insert in batches, streaming rather than holding every vector.
      let inserted = 0;
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const slice = chunks.slice(i, i + EMBED_BATCH);
        const vectors = await embedTexts(
          env,
          slice.map((c) => c.content),
        );
        const rows = slice.map((c, j) => ({
          library_document_id: libDoc.id,
          discipline: opts.discipline,
          chunk_index: c.chunk_index,
          page_start: c.page_start,
          page_end: c.page_end,
          content: c.content,
          token_estimate: c.token_estimate,
          embedding: vectors[j],
        }));
        for (let k = 0; k < rows.length; k += INSERT_BATCH) {
          await insertChunksWithRetry(supabase, rows.slice(k, k + INSERT_BATCH));
        }
        inserted += rows.length;
        process.stdout.write(`\r      embedded ${inserted}/${chunks.length} chunks`);
      }
      process.stdout.write("\r" + " ".repeat(48) + "\r");
      console.log(`      done — ${fmt(inserted)} chunks, status "${opts.status}"`);

      state.books[item.hash] = { status: "done", id: libDoc.id, title };
      saveState(state);
      ingested.push({ title, pageCount, tokens: item.tokens });
      totalChunks += inserted;
      done += 1;
    } catch (err) {
      const msg = String(err?.message ?? err);
      console.log(`      FAILED — ${msg.slice(0, 120)}`);
      failed.push({ name: item.name, msg });
      state.books[item.hash] = { status: "failed", error: msg };
      saveState(state);
    }
  }

  // ── summary ──
  console.log(`\n${"─".repeat(60)}`);
  console.log(`Ingested ${done} book(s), ${fmt(totalChunks)} chunks.`);
  if (needsOcr.length) {
    console.log(`\nNeed OCR (no text layer) — upload these through the app instead:`);
    for (const n of needsOcr) console.log(`  ${n.name.slice(0, 58)} (${n.perPage} ch/pg)`);
  }
  if (failed.length) {
    console.log(`\nFailed:`);
    for (const f of failed) console.log(`  ${f.name.slice(0, 48)} — ${f.msg.slice(0, 80)}`);
  }
  console.log(`\nState: ${STATE_FILE}`);
  console.log(`Re-running is safe: ingested books are skipped by content hash.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
