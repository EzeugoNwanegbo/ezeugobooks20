import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts } from "./theme";

const ease = Easing.bezier(0.22, 1, 0.36, 1);

function clamp(input: number, range: [number, number], output: [number, number]) {
  return interpolate(input, range, output, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
}

function Particles({ bright = false }: { bright?: boolean }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      {Array.from({ length: 44 }).map((_, index) => {
        const x = (index * 97) % 1080;
        const y = (index * 211 + frame * (bright ? 0.9 : 0.35)) % 1920;
        const size = 2 + (index % 4);
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: 999,
              background: bright ? "rgba(255,255,255,0.62)" : "rgba(148,163,184,0.32)",
              filter: "blur(0.4px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
}

function PhoneUi({ progress }: { progress: number }) {
  const rank = Math.round(clamp(progress, [0, 1], [128, 1]));
  const xp = Math.round(clamp(progress, [0, 1], [40, 2840]));
  const streak = Math.round(clamp(progress, [0, 1], [1, 30]));

  return (
    <div
      style={{
        width: 600,
        height: 1040,
        borderRadius: 56,
        padding: 26,
        background: "linear-gradient(160deg, rgba(15,23,42,0.92), rgba(2,6,23,0.86))",
        border: `1px solid ${colors.line}`,
        boxShadow: "0 42px 150px rgba(37,99,235,0.34), inset 0 1px 0 rgba(255,255,255,0.12)",
        fontFamily: fonts.sans,
        color: colors.ink,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 34 }}>GD1.ONLINE</div>
        <div style={{ color: colors.gold, fontWeight: 700, fontSize: 22 }}>L{Math.ceil(progress * 8) || 1}</div>
      </div>

      <div style={{ marginTop: 34, display: "grid", gap: 18 }}>
        <GlassCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: colors.muted, fontSize: 20 }}>Daily Streak</div>
              <div style={{ marginTop: 6, fontSize: 54, fontWeight: 800 }}>
                {streak} days
              </div>
            </div>
            <div style={{ fontSize: 70, filter: "drop-shadow(0 0 24px rgba(249,115,22,0.7))" }}>
              &#128293;
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <div style={{ color: colors.muted, fontSize: 20 }}>Leaderboard</div>
          <div style={{ marginTop: 10, fontSize: 48, fontWeight: 800 }}>#{rank}</div>
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {["You", "Maya", "Tobi"].map((name, index) => (
              <div
                key={name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "46px 1fr auto",
                  alignItems: "center",
                  borderRadius: 18,
                  padding: "12px 16px",
                  background:
                    index === 0
                      ? "linear-gradient(90deg, rgba(37,99,235,0.42), rgba(249,115,22,0.18))"
                      : "rgba(255,255,255,0.06)",
                }}
              >
                <span>#{index + 1}</span>
                <span>{name}</span>
                <span>{xp - index * 180}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22 }}>
            <span>XP</span>
            <strong>+{xp}</strong>
          </div>
          <div style={{ marginTop: 18, height: 18, borderRadius: 999, background: "rgba(255,255,255,0.12)" }}>
            <div
              style={{
                width: `${Math.max(8, progress * 100)}%`,
                height: "100%",
                borderRadius: 999,
                background: `linear-gradient(90deg, ${colors.blue}, ${colors.orange}, ${colors.gold})`,
                boxShadow: "0 0 28px rgba(250,204,21,0.42)",
              }}
            />
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 28,
        padding: 24,
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
      }}
    >
      {children}
    </div>
  );
}

function StudentScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const light = clamp(frame, [2.6 * fps, 6.2 * fps], [0, 1]);
  const push = clamp(frame, [0, 6 * fps], [1.08, 1]);
  const posture = clamp(frame, [6 * fps, 10 * fps], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${push})`,
        background: `radial-gradient(circle at 50% 38%, rgba(37,99,235,${0.18 + light * 0.22}), transparent 28%),
          radial-gradient(circle at 70% 52%, rgba(249,115,22,${light * 0.24}), transparent 34%),
          linear-gradient(180deg, #020617, #0f172a 58%, #020617)`,
      }}
    >
      <Particles bright={light > 0.45} />
      <div
        style={{
          position: "absolute",
          left: 140,
          right: 140,
          bottom: 260,
          height: 34,
          borderRadius: 999,
          background: "rgba(15,23,42,0.92)",
          boxShadow: "0 40px 120px rgba(0,0,0,0.5)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 280,
          bottom: 362,
          width: 520,
          height: 330,
          borderRadius: "34px 34px 10px 10px",
          background: `linear-gradient(160deg, rgba(15,23,42,0.92), rgba(37,99,235,${0.16 + light * 0.18}))`,
          border: "1px solid rgba(255,255,255,0.12)",
          transform: `rotateX(${6 - posture * 4}deg)`,
          boxShadow: `0 0 ${40 + light * 90}px rgba(37,99,235,${0.28 + light * 0.25})`,
        }}
      >
        <div
          style={{
            margin: 30,
            height: 20,
            width: `${32 + light * 52}%`,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${colors.blue}, ${colors.orange})`,
          }}
        />
        <div style={{ margin: 30, display: "grid", gap: 15 }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 14,
                width: `${80 - i * 11 + light * 8}%`,
                borderRadius: 999,
                background: "rgba(255,255,255,0.14)",
              }}
            />
          ))}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 438,
          bottom: 700 + posture * 22,
          width: 205,
          height: 244,
          borderRadius: "46% 46% 42% 42%",
          background: "linear-gradient(160deg, #3f2a20, #1f1512)",
          boxShadow: `0 0 ${20 + light * 70}px rgba(248,250,252,${0.08 + light * 0.16})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 374,
          bottom: 462,
          width: 330,
          height: 270,
          borderRadius: "120px 120px 28px 28px",
          background: "linear-gradient(180deg, #111827, #020617)",
          transform: `translateY(${-posture * 26}px)`,
        }}
      />
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 130 + i * 145,
            bottom: 310 + (i % 2) * 36 + light * (i % 2 ? -34 : 42),
            width: 150,
            height: 18,
            borderRadius: 6,
            background: i % 2 ? "rgba(248,250,252,0.18)" : "rgba(249,115,22,0.28)",
            transform: `rotate(${(-12 + i * 7) * (1 - light)}deg)`,
          }}
        />
      ))}
    </AbsoluteFill>
  );
}

function Transformation() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = clamp(frame, [0, 7.5 * fps], [0, 1]);
  const phoneIn = spring({ frame, fps, config: { damping: 18, stiffness: 80 } });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        background: `radial-gradient(circle at 20% 20%, rgba(37,99,235,0.32), transparent 34%),
          radial-gradient(circle at 88% 54%, rgba(249,115,22,0.28), transparent 36%),
          ${colors.black}`,
      }}
    >
      <Particles bright />
      <div
        style={{
          position: "absolute",
          top: 165,
          left: 76,
          right: 76,
          fontFamily: fonts.display,
          color: colors.ink,
        }}
      >
        <div style={{ fontSize: 28, color: colors.muted, letterSpacing: 7, textTransform: "uppercase" }}>
          One decision
        </div>
        <div style={{ marginTop: 18, fontSize: 82, lineHeight: 1.02, fontWeight: 700 }}>
          turns studying into momentum.
        </div>
      </div>
      <div
        style={{
          transform: `translateY(${90 - phoneIn * 90}px) scale(${0.9 + phoneIn * 0.1})`,
          opacity: phoneIn,
        }}
      >
        <PhoneUi progress={progress} />
      </div>
    </AbsoluteFill>
  );
}

function Montage() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cards = [
    ["Day 1", "1 day streak", colors.orange],
    ["Day 30", "30 day streak", colors.gold],
    ["Rank", "#128 to #1", colors.blue],
    ["Lessons", "18 complete", "#22C55E"],
    ["XP", "+2,840", colors.gold],
    ["Achievement", "Future unlocked", colors.orange],
  ];

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, #020617, #0f172a)`,
        padding: 72,
        fontFamily: fonts.sans,
        color: colors.ink,
      }}
    >
      <Particles bright />
      <div style={{ marginTop: 80, fontFamily: fonts.display, fontSize: 68, fontWeight: 700 }}>
        Progress you can feel.
      </div>
      <div style={{ marginTop: 38, display: "grid", gap: 22 }}>
        {cards.map(([label, value, color], i) => {
          const start = i * 22;
          const enter = spring({ frame: frame - start, fps, config: { damping: 16, stiffness: 90 } });
          return (
            <div
              key={label}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                borderRadius: 30,
                padding: "28px 30px",
                background: "rgba(255,255,255,0.075)",
                border: "1px solid rgba(255,255,255,0.12)",
                transform: `translateX(${80 - enter * 80}px)`,
                opacity: enter,
              }}
            >
              <div>
                <div style={{ color: colors.muted, fontSize: 22 }}>{label}</div>
                <div style={{ marginTop: 4, fontSize: 44, fontWeight: 800 }}>{value}</div>
              </div>
              <div
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: 28,
                  background: color,
                  boxShadow: `0 0 48px ${color}`,
                }}
              />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

function Final() {
  const frame = useCurrentFrame();
  const lines = ["Study Faster.", "Stay Consistent.", "Level Up Your Future."];
  const active = Math.min(2, Math.floor(frame / 82));
  const logo = clamp(frame, [210, 270], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "#000",
        color: colors.ink,
        fontFamily: fonts.display,
      }}
    >
      <div
        style={{
          opacity: logo,
          fontSize: 84,
          fontWeight: 800,
          letterSpacing: -2,
          textShadow: "0 0 42px rgba(37,99,235,0.72)",
        }}
      >
        GD1.ONLINE
      </div>
      <div style={{ position: "absolute", bottom: 520, left: 72, right: 72, textAlign: "center" }}>
        {lines.map((line, i) => (
          <div
            key={line}
            style={{
              position: "absolute",
              inset: 0,
              opacity: active === i ? clamp(frame - i * 82, [0, 24], [0, 1]) : 0,
              fontSize: i === 2 ? 58 : 70,
              fontWeight: 700,
            }}
          >
            {line}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          width: 360,
          height: 2,
          bottom: 448,
          background: `linear-gradient(90deg, transparent, ${colors.blue}, ${colors.orange}, transparent)`,
          opacity: logo,
        }}
      />
    </AbsoluteFill>
  );
}

function VoiceCaption() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const script = [
    [0, "Every dream begins with one decision."],
    [2.3, "One lesson. One streak. One step forward."],
    [6.5, "Learning isn't about doing more."],
    [10.5, "It's about making every day count."],
    [14.2, "Welcome to GD1.ONLINE."],
    [16.2, "Study Faster. Stay Consistent."],
  ] as const;
  const time = frame / fps;
  let current = "Level Up Your Future.";
  for (let index = 0; index < script.length; index += 1) {
    const [start, line] = script[index];
    const nextStart = script[index + 1]?.[0] ?? 99;
    if (time >= start && time < nextStart) current = line;
  }

  return (
    <div
      style={{
        position: "absolute",
        left: 76,
        right: 76,
        bottom: 106,
        borderRadius: 24,
        padding: "18px 24px",
        color: colors.ink,
        background: "rgba(2,6,23,0.54)",
        border: "1px solid rgba(255,255,255,0.10)",
        fontFamily: fonts.sans,
        fontSize: 27,
        lineHeight: 1.35,
        textAlign: "center",
      }}
    >
      {current}
    </div>
  );
}

export const FutureTrailer: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: colors.black }}>
      <Sequence durationInFrames={390}>
        <StudentScene />
      </Sequence>
      <Sequence from={300} durationInFrames={420}>
        <Transformation />
      </Sequence>
      <Sequence from={660} durationInFrames={300}>
        <Montage />
      </Sequence>
      <Sequence from={960} durationInFrames={240}>
        <Final />
      </Sequence>
      <VoiceCaption />
    </AbsoluteFill>
  );
};
