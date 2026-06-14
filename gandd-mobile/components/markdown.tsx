// Minimal Markdown renderer for assistant messages. The chat model replies in
// Markdown (**bold**, bullets, headings, `code`); a plain <Text> would show the
// raw asterisks and run everything together. This parses the common subset into
// React Native text/rows so answers read cleanly. Deliberately dependency-free
// and forgiving — partial markup mid-stream just renders as plain text.

import { Fragment, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius } from "@/lib/theme";

// Inline spans: **bold** / __bold__, *italic* / _italic_, `code`.
const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|_([^_\n]+)_|`([^`]+)`)/g;

function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) {
      out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last, match.index)}</Fragment>);
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
    out.push(<Fragment key={`${keyBase}-t${i}`}>{text.slice(last)}</Fragment>);
  }
  return out;
}

// Render one run of (non-code) markdown text into block elements.
function renderLines(text: string, keyBase: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  text.split("\n").forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) return; // blank lines collapse into block spacing
    const key = `${keyBase}-${idx}`;

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <Text key={key} style={styles.heading}>
          {renderInline(heading[2], `${key}h`)}
        </Text>,
      );
      return;
    }

    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push(
        <View key={key} style={styles.row}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={[styles.body, styles.flex]}>{renderInline(bullet[1], `${key}b`)}</Text>
        </View>,
      );
      return;
    }

    const numbered = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    if (numbered) {
      blocks.push(
        <View key={key} style={styles.row}>
          <Text style={styles.bulletNum}>{numbered[1]}.</Text>
          <Text style={[styles.body, styles.flex]}>{renderInline(numbered[2], `${key}n`)}</Text>
        </View>,
      );
      return;
    }

    blocks.push(
      <Text key={key} style={styles.body}>
        {renderInline(line, `${key}p`)}
      </Text>,
    );
  });
  return blocks;
}

export function Markdown({ content }: { content: string }) {
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
          <Text style={styles.codeBlockText}>{inner.trim()}</Text>
        </View>,
      );
      return;
    }
    blocks.push(...renderLines(part, `s${pi}`));
  });

  return <View style={styles.container}>{blocks}</View>;
}

const styles = StyleSheet.create({
  container: { gap: 7 },
  body: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 23,
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
    fontSize: 13.5,
    color: colors.accent,
  },
  heading: {
    color: colors.text,
    fontFamily: fonts.soraSemibold,
    fontSize: 16.5,
    lineHeight: 23,
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
    fontSize: 15,
    lineHeight: 23,
  },
  bulletNum: {
    color: colors.accent,
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
    lineHeight: 23,
    minWidth: 18,
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
    fontSize: 12.5,
    lineHeight: 19,
  },
});
