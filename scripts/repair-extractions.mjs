// Re-extract the documents that were only partly chunked, from their original
// PDF in storage.
//
// HOW TO RUN
//   Dry run (default - reads everything, writes nothing):
//     node --experimental-strip-types scripts/repair-extractions.mjs
//
//   For real:
//     node --experimental-strip-types scripts/repair-extractions.mjs --write
//
//   Options:
//     --write            actually repair. Without it nothing is written at all.
//     --limit <n>        stop after n documents (use for a first real run)
//     --doc <uuid>       repair exactly this document, ignoring the heuristic
//                        (repeatable, comma-separated)
//     --no-embed         write chunks, skip the embedding pass entirely
//
//   Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env, which is
//   gitignored). The service role is what lets this run with no 150-second edge
//   function ceiling, so a 2,785-page book can take as long as it needs.
//
// WHAT IT DOES
//   1. Finds every document that holds far too few chunks for its page count -
//      the SAME test as dedup.ineligible and supabase/repairs/
//      mark-partial-extractions.sql: page_count >= 20 and
//      chunk_count < page_count / 20.
//   2. Checks whether the source PDF is still in the `documents` storage bucket.
//   3. Prints what it found. In dry-run mode it stops here.
//   4. With --write, for each repairable document: mark 'processing', re-extract
//      with pdfjs, chunk with the APP'S OWN chunker (src/lib/document-chunks.ts,
//      CHUNK_CHARS 6000 / CHUNK_OVERLAP 700, page-aware) so the chunks are
//      byte-identical to a fresh upload's and the dedup content hash still
//      matches them, UPSERT on (document_id, chunk_index), drop any stale tail,
//      mark 'ready', refresh the content hash, then embed best-effort.
//
// READ THIS BEFORE YOU RUN IT
// ---------------------------
// For the documents this repair was written for, THERE IS NOTHING TO RE-EXTRACT
// FROM. The browser upload path has never uploaded the original file: since
// commit 738110c (2026-05-04) it stores the text only and writes a *virtual*
// storage_path of the form
//
//     text-only/<user id>/<timestamp>-<file name>
//
// with no storage object behind it (see src/routes/-app.library-page.tsx, and
// its own delete handler, which skips storage cleanup for exactly this prefix).
// That commit is also the one that introduced the serial-batch chunk loop which
// caused the damage, so every document broken by that bug is text-only by
// construction. Its extracted text was truncated at the same moment its chunks
// were, so there is no complete copy of the book anywhere in the system.
//
// Those documents CANNOT be repaired by any script. The student has to upload
// the file again. This script reports them as unrepairable and does not touch
// them.
//
// It is still worth running, because it repairs the cases where bytes DO exist:
//   * mobile / Links uploads (gandd-mobile/lib/links-client.ts) upload the real
//     PDF and set a real storage_path, and are extracted by the extract-pdf edge
//     function - the path that had the same class of bug and could be killed by
//     the 150-second ceiling mid-book. Those are exactly what this script's lack
//     of a time limit fixes.
//   * server-OCR documents (src/lib/server-ocr.ts) keep a folder of part PDFs.
//     Those parts are image-only scans, so this script reports them as needing
//     OCR rather than pretending a text extraction succeeded - re-run the OCR
//     queue for those instead.
//
// IDEMPOTENT AND RESUMABLE. There is no local state file, deliberately: the
// database is the state. A document that has been repaired no longer holds too
// few chunks for its page count, so the next run does not select it. Chunks are
// upserted index-for-index, so a run killed half way has merely rewritten
// identical rows and the next run finishes the job - it can never leave a
// document holding less than it started with.

import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

import {
  chunkDocumentText,
  documentPreview,
  sanitizeExtractedText,
} from "../src/lib/document-chunks.ts";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const require = createRequire(pathToFileURL(join(PROJECT_ROOT, "package.json")).href);

// pdfjs 3.x probes for the optional native `canvas` package as it loads and
// warns loudly when it is missing. We only ever extract text - nothing renders.
const originalWarn = console.warn;
console.warn = () => {};
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
console.warn = originalWarn;

const STANDARD_FONT_URL = pathToFileURL(
  join(PROJECT_ROOT, "node_modules/pdfjs-dist/standard_fonts/"),
).href;
const CMAP_URL = pathToFileURL(join(PROJECT_ROOT, "node_modules/pdfjs-dist/cmaps/")).href;

// The embed edge function batches internally at MAX_INPUTS_PER_REQUEST = 96;
// match it so one HTTP call maps to one OpenAI call with no hidden fan-out.
const EMBED_BATCH = 96;
// PostgREST + a 1536-float vector per row: the app writes 200 at a time, but the
// app is writing one student's file. On a 2,000-page textbook a 200-row
// statement can trip Postgres's statement timeout part way through. 50 keeps
// each statement comfortably inside it. Same number, same reason, as
// scripts/ingest-library.mjs.
const INSERT_BATCH = 50;
const INSERT_RETRIES = 3;
// Below this many characters per page the text layer is too sparse to index -
// the book needs OCR, which this script does not do.
const MIN_CHARS_PER_PAGE = 120;
// dedup.ineligible's threshold, and mark-partial-extractions.sql's. One chunk
// per 20 pages: a real chunk holds ~6,000 characters, roughly two to three
// pages, so a healthy book clears this by an order of magnitude.
const PAGES_PER_EXPECTED_CHUNK = 20;
const MIN_PAGES_TO_JUDGE = 20;
// Documents whose storage_path starts with this were never uploaded - the marker
// is virtual. See the header.
const TEXT_ONLY_PREFIX = "text-only/";
const SERVER_OCR_PREFIX = "serverocr/";
// DEDUP_SCHEMA_APPLIED - keep in step with src/lib/content-hash.ts. The dedup
// migration is applied by hand, and PostgREST rejects a whole statement that
// names a column or function it cannot find: with this false, filtering on
// pooled_document_id would make findTargets() fail outright, and calling
// refresh_document_content_hash would log a spurious PGRST202 on every repaired
// document. Both are skipped instead - correctly, because with no pool there are
// no pooled documents to exclude and no hash worth stamping.
const DEDUP_SCHEMA_APPLIED = false;

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { write: false, limit: Infinity, docs: [], embed: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") opts.write = true;
    else if (a === "--no-embed") opts.embed = false;
    else if (a === "--dry-run") opts.write = false; // accepted, already the default
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--doc") {
      for (const part of String(argv[++i]).split(",")) {
        const id = part.trim();
        if (id) opts.docs.push(id);
      }
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

// ── env ─────────────────────────────────────────────────────────────────────
// Identical handling to scripts/ingest-library.mjs: process env first, then .env.
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

const fmt = (n) => Number(n).toLocaleString("en-US");

// ── extraction ──────────────────────────────────────────────────────────────
// Mirrors src/lib/pdf.ts exactly: items joined with a space, each page prefixed
// "\n\n[Page N]\n". chunkDocumentText() parses those markers to attach page
// numbers, so any deviation here silently loses page citations - and, worse for
// this script, changes the chunk text and therefore the content hash.
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
    // Without this pdfjs retains every parsed page and a 2,400-page book climbs
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

// ── chunk write ─────────────────────────────────────────────────────────────
/**
 * UPSERT a batch of chunk rows on (document_id, chunk_index), halving and
 * recursing on a statement timeout.
 *
 * Upsert, not "delete everything then insert", for the same reason
 * supabase/functions/extract-pdf switched: a run that dies half way must leave
 * the document no emptier than it found it, and a retry must be pure repair.
 * The extraction is deterministic, so writing index-for-index means a killed run
 * has merely replaced the first N chunks with identical ones. document_chunks
 * carries UNIQUE (document_id, chunk_index) (migration 20260430002000) for the
 * upsert to land on.
 *
 * A statement timeout is about the size of THIS statement, not transient bad
 * luck - the same batch would fail again however many times it is retried - so
 * splitting is what actually fixes it.
 */
async function upsertChunks(supabase, rows, attempt = 0) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("document_chunks")
    .upsert(rows, { onConflict: "document_id,chunk_index" });
  if (!error) return;

  const timedOut = /statement timeout|canceling statement/i.test(error.message ?? "");
  if (timedOut && rows.length > 1 && attempt < INSERT_RETRIES) {
    const mid = Math.ceil(rows.length / 2);
    await upsertChunks(supabase, rows.slice(0, mid), attempt + 1);
    await upsertChunks(supabase, rows.slice(mid), attempt + 1);
    return;
  }
  throw new Error(`upsert chunks: ${error.message}`);
}

// ── target selection ────────────────────────────────────────────────────────
// The same test as dedup.ineligible, computed client-side because PostgREST does
// not expose the `dedup` schema. Pooled documents (pooled_document_id set) hold
// no chunks BY DESIGN - they read the G&D pool - so re-extracting one would
// write a private copy that resolution never reads. They are excluded; so is
// anything already mid-flight ('processing' / 'pending'), which would otherwise
// pull a running server-OCR job out from under itself.
async function findTargets(supabase, opts) {
  const selected = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("documents")
      .select("id, user_id, file_name, page_count, storage_path, extract_status, file_type")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (DEDUP_SCHEMA_APPLIED) query = query.is("pooled_document_id", null);
    if (opts.docs.length) query = query.in("id", opts.docs);

    const { data, error } = await query;
    if (error) throw new Error(`read documents: ${error.message}`);
    if (!data || data.length === 0) break;
    selected.push(...data);
    if (data.length < PAGE) break;
  }

  const candidates = opts.docs.length
    ? selected
    : selected.filter(
        (d) =>
          (d.page_count ?? 0) >= MIN_PAGES_TO_JUDGE &&
          d.extract_status !== "processing" &&
          d.extract_status !== "pending",
      );

  // Chunk counts, one cheap HEAD count per candidate.
  const targets = [];
  for (const doc of candidates) {
    const { count, error } = await supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", doc.id);
    if (error) throw new Error(`count chunks for ${doc.id}: ${error.message}`);
    const chunkCount = count ?? 0;
    const expected = (doc.page_count ?? 0) / PAGES_PER_EXPECTED_CHUNK;
    if (opts.docs.length || chunkCount < expected) {
      targets.push({ ...doc, chunkCount, expected: Math.ceil(expected) });
    }
  }
  return targets;
}

// ── storage probe ───────────────────────────────────────────────────────────
// Answers the question the whole script hangs on: are the bytes still there?
async function probeStorage(supabase, doc) {
  const path = doc.storage_path ?? "";
  if (!path) return { repairable: false, why: "no storage_path at all" };
  if (path.startsWith(TEXT_ONLY_PREFIX)) {
    return {
      repairable: false,
      why: "text-only upload - the original file was never sent to storage",
    };
  }
  if (path.startsWith(SERVER_OCR_PREFIX)) {
    const { data } = await supabase.storage.from("documents").list(path);
    const parts = (data ?? []).filter((o) => o.name.endsWith(".pdf"));
    return {
      repairable: false,
      why: parts.length
        ? `server-OCR document (${parts.length} scanned parts still in storage) - needs OCR, not text extraction; re-run the OCR queue`
        : "server-OCR document whose parts are gone from storage",
    };
  }

  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const { data, error } = await supabase.storage.from("documents").list(dir, { search: name });
  if (error) return { repairable: false, why: `storage list failed: ${error.message}` };
  const found = (data ?? []).some((o) => o.name === name);
  return found
    ? { repairable: true, why: "source PDF present in storage" }
    : { repairable: false, why: "source PDF is no longer in storage" };
}

// ── repair one document ─────────────────────────────────────────────────────
async function repairDocument(supabase, env, doc, opts) {
  // Say plainly that it is not usable while we work. If this process dies the
  // document is left visibly unfinished rather than silently fine - the same
  // property extract-pdf now guarantees.
  await supabase
    .from("documents")
    .update({ extract_status: "processing", extract_error: null })
    .eq("id", doc.id);

  const fail = async (message) => {
    await supabase
      .from("documents")
      .update({ extract_status: "error", extract_error: message })
      .eq("id", doc.id);
    throw new Error(message);
  };

  const { data: file, error: dlErr } = await supabase.storage
    .from("documents")
    .download(doc.storage_path);
  if (dlErr || !file) {
    await fail("We could not read the original file to rebuild this document. Please upload it again.");
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const { text, pageCount } = await extractPdf(buffer, (p, total) => {
    process.stdout.write(`\r      reading ${p}/${total} pages`);
  });
  process.stdout.write("\r" + " ".repeat(44) + "\r");

  const clean = sanitizeExtractedText(text.replace(/\[Page \d+\]/g, " "));
  const perPage = Math.round(clean.length / Math.max(pageCount, 1));
  if (perPage < MIN_CHARS_PER_PAGE) {
    await fail(
      "This file has no selectable text - it looks scanned. Delete it and upload it again so it can be OCR-ed.",
    );
  }

  // The app's own chunker, on the app's own page-marked text. Identical rules
  // means identical chunks means the same content hash, so the staged dedup work
  // still recognises a repaired book as the same book.
  const chunks = chunkDocumentText(text);
  if (chunks.length === 0) {
    await fail("We could not find any readable text in this file. Please upload it again.");
  }
  console.log(
    `      ${fmt(pageCount)} pages · ${fmt(clean.length)} chars · ${fmt(chunks.length)} chunks (had ${fmt(doc.chunkCount)})`,
  );

  // 1. Text + page count first, so Links synthesis has something even if the
  //    chunk write is interrupted. Status stays 'processing'.
  const { error: textErr } = await supabase
    .from("documents")
    .update({ extracted_text: documentPreview(text), page_count: pageCount })
    .eq("id", doc.id);
  if (textErr) await fail(`Could not save the extracted text: ${textErr.message}`);

  // 2. Every chunk, with NULL embeddings. This is the part the document's
  //    usefulness depends on, so it happens on its own with no third-party call
  //    in the way: a slow or dead OpenAI can no longer stop a book being
  //    searchable at all.
  const rows = chunks.map((c) => ({
    document_id: doc.id,
    user_id: doc.user_id,
    chunk_index: c.chunk_index,
    page_start: c.page_start,
    page_end: c.page_end,
    content: c.content,
    token_estimate: c.token_estimate,
    embedding: null,
  }));
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await upsertChunks(supabase, rows.slice(i, i + INSERT_BATCH));
    process.stdout.write(`\r      wrote ${Math.min(i + INSERT_BATCH, rows.length)}/${rows.length} chunks`);
  }
  process.stdout.write("\r" + " ".repeat(44) + "\r");

  // 3. Only now is it safe to drop the tail of any older, longer chunk set - the
  //    replacement already exists. Best-effort: a stale trailing chunk is
  //    duplicated context, not lost content.
  const { error: pruneErr } = await supabase
    .from("document_chunks")
    .delete()
    .eq("document_id", doc.id)
    .gte("chunk_index", rows.length);
  if (pruneErr) console.log(`      note: stale chunk prune failed (${pruneErr.message})`);

  // 4. Complete and searchable: say so. ONLY here, and only because every chunk
  //    above committed.
  const { error: readyErr } = await supabase
    .from("documents")
    .update({ extract_status: "ready", extract_error: null })
    .eq("id", doc.id);
  if (readyErr) throw new Error(`mark ready: ${readyErr.message}`);

  // 5. Re-fingerprint, so the staged dedup work can collapse this copy against
  //    the identical books other students uploaded. Best-effort: a missing hash
  //    costs storage, nothing else.
  if (DEDUP_SCHEMA_APPLIED) {
    const { error: hashErr } = await supabase.rpc("refresh_document_content_hash", {
      p_document_id: doc.id,
    });
    if (hashErr) console.log(`      note: content hash refresh failed (${hashErr.message})`);
  }

  // 6. Embeddings, best-effort. Degrade to NULL rather than abort: chunks stay
  //    keyword-searchable, and the app's backfillMissingEmbeddings fills the
  //    vectors in later.
  let embedded = 0;
  let embedFailures = 0;
  if (opts.embed) {
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const slice = chunks.slice(i, i + EMBED_BATCH);
      let vectors;
      try {
        vectors = await embedTexts(
          env,
          slice.map((c) => c.content),
        );
      } catch (err) {
        embedFailures += 1;
        console.log(`      embed batch failed (${String(err.message).slice(0, 80)}) - left NULL`);
        if (embedFailures >= 2) {
          console.log("      giving up on embeddings for this book; backfill will catch up");
          break;
        }
        continue;
      }
      const embeddedRows = slice.map((c, j) => ({
        document_id: doc.id,
        user_id: doc.user_id,
        chunk_index: c.chunk_index,
        page_start: c.page_start,
        page_end: c.page_end,
        content: c.content,
        token_estimate: c.token_estimate,
        embedding: vectors[j],
      }));
      try {
        for (let k = 0; k < embeddedRows.length; k += INSERT_BATCH) {
          await upsertChunks(supabase, embeddedRows.slice(k, k + INSERT_BATCH));
        }
        embedded += embeddedRows.length;
      } catch (err) {
        console.log(`      embedding write failed (${String(err.message).slice(0, 80)}) - left NULL`);
        break;
      }
      process.stdout.write(`\r      embedded ${embedded}/${chunks.length}`);
    }
    process.stdout.write("\r" + " ".repeat(44) + "\r");
  }

  return { chunks: chunks.length, pageCount, embedded };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = loadEnv();
  if (!env.url || !env.serviceKey) {
    console.error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Add SUPABASE_SERVICE_ROLE_KEY to .env (it is gitignored). Both the dry run and\n" +
        "the repair need it - the dry run reads every user's documents, which no\n" +
        "anon-key client is allowed to do.",
    );
    process.exit(1);
  }

  const supabase = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });

  console.log(`\n${opts.write ? "REPAIR" : "DRY RUN — nothing will be written"}`);
  console.log("Looking for documents with far too few chunks for their page count");
  console.log(`(the dedup.ineligible test: page_count >= ${MIN_PAGES_TO_JUDGE} and`);
  console.log(`chunk_count < page_count / ${PAGES_PER_EXPECTED_CHUNK})\n`);

  const targets = await findTargets(supabase, opts);
  if (targets.length === 0) {
    console.log("Nothing under-chunked. Either the repair is done or there was never any damage.");
    return;
  }

  // Which of these can actually be repaired? This is the finding that decides
  // whether the script is useful at all.
  const repairable = [];
  const unrepairable = [];
  for (const doc of targets) {
    const probe = await probeStorage(supabase, doc);
    (probe.repairable ? repairable : unrepairable).push({ ...doc, why: probe.why });
  }

  const row = (d) =>
    `  ${String(d.chunkCount).padStart(5)} / ${String(d.expected).padEnd(5)} chunks  ` +
    `${String(d.page_count ?? "?").padStart(5)}p  ${String(d.file_name).slice(0, 46)}`;

  console.log(`${targets.length} under-chunked document(s).\n`);
  console.log(`REPAIRABLE — the source PDF is still in storage (${repairable.length}):`);
  if (repairable.length === 0) console.log("  (none)");
  for (const d of repairable) console.log(row(d));

  console.log(`\nNOT REPAIRABLE — nothing to re-extract from (${unrepairable.length}):`);
  if (unrepairable.length === 0) console.log("  (none)");
  for (const d of unrepairable) {
    console.log(row(d));
    console.log(`         ${d.why}`);
  }
  if (unrepairable.length) {
    console.log(
      "\n  These cannot be fixed by any script - the bytes are gone. Run\n" +
        "  supabase/repairs/mark-partial-extractions.sql so their owners are told to\n" +
        "  delete and re-upload, instead of silently getting nothing back.",
    );
  }

  if (!opts.write) {
    console.log(
      `\nDry run — nothing written. ${Math.min(repairable.length, opts.limit)} document(s) would be repaired.`,
    );
    console.log("Re-run with --write to do it.");
    return;
  }

  let done = 0;
  let totalChunks = 0;
  const failed = [];
  for (const doc of repairable) {
    if (done >= opts.limit) break;
    console.log(
      `\n[${done + 1}/${Math.min(repairable.length, opts.limit)}] ${String(doc.file_name).slice(0, 52)}`,
    );
    try {
      const result = await repairDocument(supabase, env, doc, opts);
      console.log(
        `      done — ${fmt(result.chunks)} chunks (${fmt(result.embedded)} embedded), status "ready"`,
      );
      totalChunks += result.chunks;
      done += 1;
    } catch (err) {
      const msg = String(err?.message ?? err);
      console.log(`      FAILED — ${msg.slice(0, 140)}`);
      failed.push({ name: doc.file_name, msg });
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Repaired ${done} document(s), ${fmt(totalChunks)} chunks.`);
  if (failed.length) {
    console.log("\nFailed (left marked 'error' with a message for the student):");
    for (const f of failed) console.log(`  ${String(f.name).slice(0, 48)} — ${f.msg.slice(0, 90)}`);
  }
  console.log("\nRe-running is safe: repaired documents are no longer under-chunked, so they");
  console.log("are not selected again, and chunk writes upsert index-for-index.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
