// Minimal Markdown renderer for assistant messages. The chat model replies in
// Markdown (**bold**, bullets, headings, `code`); a plain <Text> would show the
// raw asterisks and run everything together. This parses the common subset into
// React Native text/rows so answers read cleanly. Deliberately dependency-free
// and forgiving — partial markup mid-stream just renders as plain text.
//
// Optional interactions (all off unless the caller opts in, so Last Minute /
// Coach render exactly as before):
//   • terms + onTermPress → underline detected key terms and make them tappable.
//   • selectable → let the user drag-select the answer text (highlight + Copy via
//     the OS menu). Chat also disables its tab-swipe so the drag isn't stolen.

import { Fragment, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius } from "@/lib/theme";

// Inline spans: **bold** / __bold__, *italic* / _italic_, `code`.
const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`)/g;

// Shared across one whole answer render: the term matcher, the tap handler, and
// the set of terms already underlined (so each is only wrapped on first use).
type TermCtx = {
  regex: RegExp;
  used: Set<string>;
  onPress: (term: string) => void;
};

function buildTermRegex(terms: string[]): RegExp | null {
  if (!terms.length) return null;
  const ordered = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:${ordered.join("|")})\\b`, "g");
}

// Split a plain-text run and wrap the first (not-yet-used) occurrence of each
// detected term in a tappable, dotted-underline <Text>.
function wrapTermsInText(text: string, keyBase: string, ctx: TermCtx): ReactNode[] {
  ctx.regex.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  let match: RegExpExecArray | null;

  while ((match = ctx.regex.exec(text)) !== null) {
    const term = match[0];
    const key = term.toLowerCase();
    if (ctx.used.has(key)) continue; // already underlined once in this answer
    ctx.used.add(key);

    if (match.index > last) {
      out.push(<Fragment key={`${keyBase}-p${k}`}>{text.slice(last, match.index)}</Fragment>);
    }
    out.push(
      <Text
        key={`${keyBase}-term${k}`}
        style={styles.term}
        suppressHighlighting
        onPress={() => ctx.onPress(term)}
      >
        {term}
      </Text>,
    );
    last = match.index + term.length;
    k += 1;
  }

  if (last === 0) return [<Fragment key={`${keyBase}-p0`}>{text}</Fragment>];
  if (last < text.length)
    out.push(<Fragment key={`${keyBase}-p${k}`}>{text.slice(last)}</Fragment>);
  return out;
}

function pushPlain(out: ReactNode[], text: string, key: string, ctx?: TermCtx) {
  if (!ctx) {
    out.push(<Fragment key={key}>{text}</Fragment>);
    return;
  }
  for (const node of wrapTermsInText(text, key, ctx)) out.push(node);
}

function renderInline(text: string, keyBase: string, ctx?: TermCtx): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) {
      pushPlain(out, text.slice(last, match.index), `${keyBase}-t${i}`, ctx);
    }
    const key = `${keyBase}-m${i}`;
    if (match[2] != null || match[3] != null) {
      out.push(
        <Text key={key} style={styles.bold}>
          {match[2] ?? match[3]}
        </Text>,
      );
    } else if (match[4] != null || match[5] != null) {
      out.push(
        <Text key={key} style={styles.italic}>
          {match[4] ?? match[5]}
        </Text>,
      );
    } else if (match[6] != null) {
      out.push(
        <Text key={key} style={styles.code}>
          {match[6]}
        </Text>,
      );
    }
    last = match.index + match[0].length;
    i += 1;
  }
  if (last < text.length) {
    pushPlain(out, text.slice(last), `${keyBase}-t${i}`, ctx);
  }
  return out;
}

// Render one run of (non-code) markdown text into block elements.
function renderLines(
  text: string,
  keyBase: string,
  ctx?: TermCtx,
  selectable?: boolean,
): ReactNode[] {
  const blocks: ReactNode[] = [];
  text.split("\n").forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) return; // blank lines collapse into block spacing
    const key = `${keyBase}-${idx}`;

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <Text key={key} selectable={selectable} style={styles.heading}>
          {renderInline(heading[2], `${key}h`, ctx)}
        </Text>,
      );
      return;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push(
        <View key={key} style={styles.row}>
          <Text style={styles.bulletDot}>•</Text>
          <Text selectable={selectable} style={[styles.body, styles.flex]}>
            {renderInline(bullet[1], `${key}b`, ctx)}
          </Text>
        </View>,
      );
      return;
    }

    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push(
        <View key={key} style={styles.row}>
          <Text style={styles.bulletNum}>{numbered[1]}.</Text>
          <Text selectable={selectable} style={[styles.body, styles.flex]}>
            {renderInline(numbered[2], `${key}n`, ctx)}
          </Text>
        </View>,
      );
      return;
    }

    blocks.push(
      <Text key={key} selectable={selectable} style={styles.body}>
        {renderInline(line, `${key}p`, ctx)}
      </Text>,
    );
  });
  return blocks;
}

export function Markdown({
  content,
  terms,
  onTermPress,
  selectable,
}: {
  content: string;
  terms?: string[];
  onTermPress?: (term: string) => void;
  selectable?: boolean;
}) {
  const regex = terms && terms.length && onTermPress ? buildTermRegex(terms) : null;
  // One ctx per render → one shared `used` set across every block of this answer.
  const ctx: TermCtx | undefined =
    regex && onTermPress ? { regex, used: new Set(), onPress: onTermPress } : undefined;

  // Split out ```fenced``` code blocks so their contents are shown verbatim in a
  // mono block instead of being parsed as markdown (which would mangle the code).
  const parts = content.replace(/\r/g, "").split(/(```[\s\S]*?```)/g);
  const blocks: ReactNode[] = [];

  parts.forEach((part, pi) => {
    if (!part) return;
    if (part.startsWith("```")) {
      const inner = part.replace(/^```[^\n]*\n?/, "").replace(/```\s*$/, "");
      blocks.push(
        <View key={`c${pi}`} style={styles.codeBlock}>
          <Text selectable={selectable} style={styles.codeBlockText}>
            {inner.trim()}
          </Text>
        </View>,
      );
      return;
    }
    blocks.push(...renderLines(part, `s${pi}`, ctx, selectable));
  });

  return <View style={styles.container}>{blocks}</View>;
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  body: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 16.5,
    lineHeight: 26,
  },
  flex: { flex: 1 },
  bold: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
  },
  italic: {
    fontStyle: "italic",
  },
  code: {
    fontFamily: fonts.mono,
    fontSize: 14.5,
    color: colors.accent,
  },
  term: {
    color: colors.accent,
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: colors.accent,
  },
  heading: {
    color: colors.text,
    fontFamily: fonts.soraSemibold,
    fontSize: 18.5,
    lineHeight: 26,
    marginTop: 2,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  bulletDot: {
    color: colors.accent,
    fontFamily: fonts.body,
    fontSize: 16.5,
    lineHeight: 26,
  },
  bulletNum: {
    color: colors.accent,
    fontFamily: fonts.bodySemibold,
    fontSize: 15.5,
    lineHeight: 26,
    minWidth: 20,
  },
  codeBlock: {
    backgroundColor: colors.surfaceLowest,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 12,
  },
  codeBlockText: {
    color: colors.muted,
    fontFamily: fonts.mono,
    fontSize: 13.5,
    lineHeight: 20,
  },
});
