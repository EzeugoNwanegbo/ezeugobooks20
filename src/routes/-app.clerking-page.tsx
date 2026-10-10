import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, Download, FileText, Mic, Printer, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { sections, generateClerking, draftText, clerkingAvailable } from "@/lib/clerking";
import type { Draft, Intake, SectionId } from "@/lib/clerking";
import { useClerkingVoice } from "@/lib/use-clerking-voice";
import "./clerking.css";

const empty = (): Intake => ({
  answers: Object.fromEntries(sections.map((s) => [s.id, ""])) as Intake["answers"],
  clinicianFindings: "",
});
export function ClerkingPage() {
  const [intake, setIntake] = useState<Intake>(empty);
  const [step, setStep] = useState(0);
  const [consent, setConsent] = useState(false);
  const [language, setLanguage] = useState("en-NG");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftInput, setDraftInput] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const voice = useClerkingVoice();
  const current = sections[step];
  const changed = !!draft && draftInput !== JSON.stringify(intake);
  const hasAnswers = Object.values(intake.answers).some(Boolean) || !!intake.clinicianFindings;
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    clerkingAvailable(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setAvailable(value);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, []);
  useEffect(() => {
    if (!hasAnswers) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [hasAnswers]);
  const answer = (id: SectionId, text: string) => {
    setIntake((v) => ({ ...v, answers: { ...v.answers, [id]: text } }));
    setReviewed(false);
  };
  const go = (index: number) => {
    voice.stop();
    voice.hush();
    setStep(index);
  };
  const generate = async () => {
    if (available === false) return;
    voice.stop();
    voice.hush();
    setError("");
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 75000);
    setBusy(true);
    try {
      const result = await generateClerking(intake, controller.signal);
      if (!controller.signal.aborted) {
        setDraft(result);
        setDraftInput(JSON.stringify(intake));
        setReviewed(false);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "The draft could not be generated.");
      else
        setError(
          "Generation stopped or timed out. Your answers are still available. Check your credits before trying again.",
        );
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  const reset = () => {
    if (
      hasAnswers &&
      !window.confirm("Clear this patient interview and draft? Download any notes you need first.")
    )
      return;
    request.current?.abort();
    voice.stop();
    voice.hush();
    setIntake(empty());
    setStep(0);
    setConsent(false);
    setDraft(null);
    setReviewed(false);
    setError("");
  };
  const download = () => {
    if (!draft || changed) return;
    const url = URL.createObjectURL(
      new Blob([draftText(draft, reviewed)], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "patient-clerking-draft.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const renderSections = (items: Draft["sections"]) => (
    <>
      {items.map((s) => (
        <section key={s.id} className="mb-6">
          <h3 className="mb-2 font-semibold">{s.heading}</h3>
          <textarea
            aria-label={`Draft ${s.heading}`}
            className="clerk-text clerk-no-print"
            value={s.text}
            rows={Math.min(10, Math.max(2, Math.ceil(s.text.length / 80)))}
            onChange={(e) => {
              setDraft((v) =>
                v
                  ? {
                      ...v,
                      sections: v.sections.map((x) =>
                        x.id === s.id ? { ...x, text: e.target.value } : x,
                      ),
                    }
                  : null,
              );
              setReviewed(false);
            }}
          />
          <p className="clerk-print-only whitespace-pre-wrap">{s.text}</p>
          {s.evidence.length > 0 && (
            <details className="clerk-no-print mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Check against patient’s words</summary>
              {s.evidence.map((e, i) => (
                <blockquote key={i} className="mt-2 border-l-2 pl-3">
                  “{e.quote}”
                </blockquote>
              ))}
            </details>
          )}
        </section>
      ))}
    </>
  );
  return (
    <main className="ph-no-capture ph-mask clerk-page mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-8">
      <header className="clerk-no-print flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-widest text-pop">G&D · Clinical tools</p>
          <h1 className="text-3xl font-semibold">Patient clerking</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Speak through the history. Prepare an editable draft in your clerking format.
          </p>
        </div>
        <button className="clerk-button" disabled={busy} onClick={reset}>
          New patient
        </button>
      </header>
      <div className="clerk-no-print rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        If the patient has severe breathlessness at rest, ongoing chest pain, collapse or other
        urgent symptoms, seek immediate clinical assessment. Do not wait for this interview or an AI
        draft.
      </div>
      <section className="clerk-no-print rounded-2xl border bg-card p-5 space-y-3">
        <h2 className="font-semibold">Before you start</h2>
        <p className="text-sm text-muted-foreground">
          Use initials rather than full names. Speech recognition may be processed by your browser’s
          speech service. Generating a draft sends the written history to G&D’s AI service. This
          page does not save the history to your account; download the draft before leaving.
        </p>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy}
            onChange={(e) => {
              setConsent(e.target.checked);
              if (!e.target.checked) {
                voice.stop();
                voice.hush();
              }
            }}
            className="mt-1"
          />
          The patient agrees to use voice and AI assistance for preparing a history draft.
        </label>
      </section>
      <div className="clerk-no-print grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex flex-wrap gap-2 lg:flex-col" aria-label="Clerking sections">
          {sections.map((s, i) => (
            <button
              key={s.id}
              disabled={busy}
              aria-current={i === step ? "step" : undefined}
              className={`rounded-xl border px-3 py-2 text-left text-sm ${i === step ? "border-pop bg-pop/10" : "border-border"}`}
              onClick={() => go(i)}
            >
              <span className="mr-2 text-muted-foreground">{i + 1}.</span>
              {s.heading}
              {intake.answers[s.id] && (
                <span className="ml-2 text-pop" aria-label="Answered">
                  ✓
                </span>
              )}
            </button>
          ))}
        </nav>
        <section className="rounded-2xl border bg-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">
                Question {step + 1} of {sections.length}
              </p>
              <h2 className="mt-1 text-xl font-semibold">{current.heading}</h2>
            </div>
            <label className="text-xs text-muted-foreground">
              Speech language
              <select
                aria-label="Speech language"
                className="mt-1 block rounded-lg border bg-background p-2"
                value={language}
                disabled={voice.listening || busy}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="en-NG">English (Nigeria)</option>
                <option value="en-GB">English (UK)</option>
                <option value="en-US">English (US)</option>
              </select>
            </label>
          </div>
          <p className="my-5 text-lg leading-relaxed">{current.question}</p>
          <div className="mb-4 flex flex-wrap gap-3">
            <button
              className="clerk-button"
              disabled={!consent || busy || !voice.canSpeak}
              onClick={() => (voice.speaking ? voice.hush() : voice.hear(current.question))}
            >
              <Volume2 size={17} />
              {voice.speaking ? "Stop question" : "Hear question"}
            </button>
            <button
              className="clerk-button clerk-primary"
              disabled={!consent || busy || !voice.supported}
              onClick={() =>
                voice.listening
                  ? voice.stop()
                  : voice.start(
                      intake.answers[current.id],
                      (text) => answer(current.id, text),
                      language,
                    )
              }
            >
              <Mic size={17} />
              {voice.listening ? "Stop listening" : "Speak answer"}
            </button>
          </div>
          {!voice.supported && (
            <p className="mb-3 text-sm text-muted-foreground">
              Voice input is unavailable in this browser. Try Chrome or Edge, or type your answers
              below.
            </p>
          )}
          {voice.listening && (
            <p role="status" className="mb-3 text-sm text-pop">
              Listening… speak naturally, then stop to check the captured words.
            </p>
          )}
          {voice.error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {voice.error}
            </p>
          )}
          <label className="block text-sm font-medium" htmlFor="clerk-answer">
            Patient’s answer
          </label>
          <textarea
            id="clerk-answer"
            className="clerk-text mt-2"
            placeholder="Speak or type here. Check names, numbers, medicines and any ‘yes’ or ‘no’ before continuing."
            rows={6}
            maxLength={8000}
            value={intake.answers[current.id]}
            disabled={voice.listening || busy || !consent}
            onChange={(e) => answer(current.id, e.target.value)}
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              className="clerk-button"
              disabled={step === 0 || busy}
              onClick={() => go(step - 1)}
            >
              Previous
            </button>
            {step < sections.length - 1 ? (
              <button
                className="clerk-button"
                disabled={busy || !consent}
                onClick={() => go(step + 1)}
              >
                Next question
              </button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ready for clinician review and draft generation.
              </p>
            )}
          </div>
        </section>
      </div>
      <details className="clerk-no-print rounded-2xl border bg-card p-5">
        <summary className="cursor-pointer font-semibold">
          Clinician examination findings (optional)
        </summary>
        <p className="my-3 text-sm text-muted-foreground">
          For the clinician to enter observed findings. G&D will copy these verbatim into a separate
          section.
        </p>
        <textarea
          aria-label="Clinician examination findings"
          className="clerk-text"
          disabled={busy || !consent}
          rows={4}
          maxLength={8000}
          value={intake.clinicianFindings}
          onChange={(e) => {
            setIntake((v) => ({ ...v, clinicianFindings: e.target.value }));
            setReviewed(false);
          }}
        />
      </details>
      <div className="clerk-no-print space-y-3">
        {available === false && (
          <p role="status" className="rounded-xl border border-amber-500/30 p-4 text-sm">
            Draft generation is temporarily unavailable. You can complete the voice interview now;
            your answers stay on this page until you leave.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="clerk-button clerk-primary"
            disabled={
              available === false ||
              busy ||
              !consent ||
              (!intake.answers.complaint && !intake.answers.hpc)
            }
            onClick={generate}
          >
            <FileText size={18} />
            {busy ? "Preparing draft…" : "Generate clerking draft · 2 credits"}
          </button>
          {busy && (
            <button className="clerk-button" onClick={() => request.current?.abort()}>
              <X size={16} />
              Cancel
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            Voice interview: no AI credit charge. Each draft generation: 2 credits.
          </span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      {draft && (
        <article className="clerk-draft rounded-2xl border bg-card p-6 sm:p-8">
          <div className="clerk-no-print mb-6">
            <h2 className="text-2xl font-semibold">Clerking draft</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Check each section against the patient’s words. AI can omit or misinterpret details.
            </p>
            {changed && (
              <p role="alert" className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm">
                The interview changed after this draft. Generate a new draft before exporting.
              </p>
            )}
          </div>
          <div className="clerk-paper clerk-page-one">
            <h2 className="mb-4 text-lg font-semibold">
              Page 1 — Patient Information and History of Presenting Complaint
            </h2>
            <p className="mb-6 text-xs uppercase tracking-wide">
              {reviewed ? "Clinician review confirmed" : "Draft — clinician review required"}
            </p>
            {renderSections(draft.sections.slice(0, 4))}
          </div>
          <div className="clerk-paper clerk-page-two">
            <h2 className="mb-6 text-lg font-semibold">Page 2 — Continuation of History</h2>
            {renderSections(draft.sections.slice(4))}
            <section>
              <h3 className="font-semibold">Clinician examination findings</h3>
              <p className="mt-2 whitespace-pre-wrap">
                {draft.clinicianFindings || "Not obtained."}
              </p>
            </section>
          </div>
          {draft.clarifications.length > 0 && (
            <section className="clerk-clarifications mt-6 rounded-xl border border-amber-500/30 p-4">
              <h3 className="mb-3 font-semibold">Points to clarify</h3>
              {draft.clarifications.map((c, i) => (
                <div key={i} className="mb-4">
                  <p className="font-medium">{c.question}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{c.reason}</p>
                  <div className="clerk-no-print mt-2 flex flex-wrap gap-2">
                    <button
                      className="clerk-button"
                      onClick={() => voice.hear(c.question)}
                      disabled={!consent || busy}
                    >
                      Hear follow-up
                    </button>
                    <button
                      className="clerk-button"
                      onClick={() => {
                        go(sections.findIndex((s) => s.id === c.sectionId));
                        document
                          .getElementById("clerk-answer")
                          ?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                      disabled={busy}
                    >
                      Add answer to history
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <label className="clerk-no-print mt-6 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={changed}
              onChange={(e) => setReviewed(e.target.checked)}
              className="mt-1"
            />
            A clinician has checked this draft, including uncertain details, medication history and
            any examination findings.
          </label>
          <div className="clerk-no-print mt-5 flex flex-wrap gap-3">
            <button
              className="clerk-button"
              disabled={changed}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(draftText(draft, reviewed));
                  toast.success("Clerking draft copied.");
                } catch {
                  toast.error("Could not copy. Use Download instead.");
                }
              }}
            >
              <ClipboardCopy size={17} />
              Copy draft
            </button>
            <button className="clerk-button" disabled={changed} onClick={download}>
              <Download size={17} />
              Download text
            </button>
            <button className="clerk-button" disabled={changed} onClick={() => window.print()}>
              <Printer size={17} />
              Print / save PDF
            </button>
          </div>
        </article>
      )}
    </main>
  );
}
