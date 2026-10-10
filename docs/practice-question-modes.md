# Recall and Applied questions

The website's two question modes are **Recall** and **Applied**, both intended
to be challenging. Recall asks precise facts, conditions, sequences and
exceptions directly; Applied asks students to combine facts in a supported
scenario. Learning/Exam remain separate settings for when feedback is shown.

Wire and stored values stay `medium` (Recall) and `hard` (Applied) so existing
sessions and apps remain compatible. Legacy `easy` and `easier` requests use
challenging Recall. Explicit `recall`/`applied` values are accepted too. Existing
stored question content is not rewritten; historical labels are mapped for
display. Battle Royale's hard requests use the same Applied generator rules.

Both modes require four A–D options, close in length, parallel in structure and
plausible from the source. Instructions require one defensible best answer,
with the decisive fact separating it from the closest distractor. They prohibit
obvious nonsense, duplicate meanings, wording matches, unsupported assumptions
and gratuitous ambiguity. The explanation identifies the decisive source fact
and why the closest distractor is wrong.

Before accepting an MCQ, the server rejects missing/duplicate option IDs,
invalid answer keys, exact duplicate choice texts, all/none-of-the-above,
empty explanations and obvious length imbalances. Word counts can differ by
at most two for short options, or 25% for longer ones. Character-length spread
is bounded as well, and an answer more than one word longer than every other
choice is rejected. These checks cannot prove that a model's options are
semantically unique or clinically correct; review of generated questions still
matters. Closely matched wording is a quality goal, not a guarantee that all
AI-generated items meet an examination board's standard.

Correct answers are balanced and shuffled across the final accepted MCQ set:
counts across A–D differ by at most one, including partial sets. The whole-set
schedule avoids a predictable repeating block of four. Distractors are shuffled
too. Answer content is preserved, keys updated, and explicit explanation letter
references remapped. Intermediate SSE batch frames convey progress; the final
done frame is the canonical list used by web and mobile clients.

Rejected questions use the existing bounded top-up process and provider budget.
No unlimited retry loop or additional per-question credit charge was added.
Sets may be shorter if material or acceptable questions are exhausted.

Run `node --test supabase/functions/studybody/question-quality.test.mjs` for
legacy mode mapping, option rejection, answer-key integrity, explanation
references and answer distribution across 1–80 item sets.

Deploy the updated `studybody` Supabase function to activate the generation
rules; publishing the frontend alone changes selectors and display labels.
The repository's missing `SUPABASE_ACCESS_TOKEN` Actions secret currently
prevents automatic backend deployment, as with the clerking feature.
