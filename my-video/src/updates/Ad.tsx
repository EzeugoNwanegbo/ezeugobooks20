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
import {colors, fonts, SAFE} from "./theme";

const ease = Easing.bezier(0.22, 1, 0.36, 1);

const ramp = (frame: number, from: number, to: number, out: [number, number] = [0, 1]) =>
  interpolate(frame, [from, to], out, {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const pop = (frame: number, fps: number, delay = 0) =>
  spring({frame: frame - delay, fps, config: {damping: 16, stiffness: 130, mass: 0.7}});

const blurIn = (frame: number, fps: number, delay = 0) => {
  const amount = pop(frame, fps, delay);
  return {
    opacity: amount,
    transform: `translateY(${(1 - amount) * 42}px) scale(${0.94 + amount * 0.06})`,
    filter: `blur(${(1 - amount) * 12}px)`,
  };
};

const Background: React.FC<{accent?: string}> = ({accent = colors.lime}) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 85) * 34;
  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background: `radial-gradient(circle at 12% 9%, ${accent}22, transparent 28%),
          radial-gradient(circle at 87% 78%, ${colors.lavender}19, transparent 31%), ${colors.bg}`,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 960,
          height: 960,
          top: -370 + drift,
          right: -450,
          borderRadius: "50%",
          border: `1px solid ${accent}38`,
          boxShadow: `0 0 150px ${accent}18, inset 0 0 120px ${accent}0d`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          bottom: -245 - drift,
          left: -210,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${colors.lavender}20, transparent 68%)`,
        }}
      />
      {Array.from({length: 28}).map((_, index) => {
        const x = (index * 173 + 71) % 1080;
        const y = (index * 283 + frame * (0.18 + (index % 3) * 0.04)) % 1920;
        const size = index % 4 === 0 ? 5 : 3;
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: 99,
              background: index % 3 === 0 ? accent : "rgba(244,240,231,0.32)",
              opacity: 0.38 + (index % 4) * 0.1,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Eyebrow: React.FC<{children: React.ReactNode; color?: string}> = ({children, color = colors.lime}) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      color,
      fontFamily: fonts.mono,
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: 3.5,
      textTransform: "uppercase",
    }}
  >
    <span style={{width: 28, height: 2, background: color}} />
    {children}
  </div>
);

const AppBar: React.FC<{label?: string}> = ({label = "gd · study workspace"}) => (
  <div
    style={{
      height: 66,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 26px",
      background: "rgba(255,255,255,0.055)",
      borderBottom: `1px solid ${colors.line}`,
      fontFamily: fonts.sans,
    }}
  >
    <div style={{display: "flex", alignItems: "center", gap: 12, color: colors.cream, fontWeight: 700}}>
      <span style={{width: 20, height: 20, borderRadius: 7, background: colors.lime, boxShadow: `0 0 18px ${colors.lime}88`}} />
      {label}
    </div>
    <div style={{display: "flex", gap: 8}}>
      {[0, 1, 2].map((i) => <span key={i} style={{width: 8, height: 8, borderRadius: 99, background: "rgba(244,240,231,0.35)"}} />)}
    </div>
  </div>
);

const UploadScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const documentIn = pop(frame, fps, 9);
  const fill = ramp(frame, 42, 150);
  const count = Math.round(ramp(frame, 45, 150, [0, 3000]));
  const complete = ramp(frame, 158, 183);

  return (
    <AbsoluteFill>
      <Background accent={colors.mint} />
      <div style={{position: "absolute", top: 154, left: SAFE.left, right: SAFE.right, ...blurIn(frame, fps)}}>
        <Eyebrow color={colors.mint}>Faster uploads</Eyebrow>
        <div style={{marginTop: 27, color: colors.cream, fontFamily: fonts.display, fontSize: 80, lineHeight: 1.03, fontWeight: 700, letterSpacing: -3}}>
          Big textbooks.<br />No waiting around.
        </div>
      </div>
      <div
        style={{
          position: "absolute", left: 76, right: 76, top: 625, height: 630, borderRadius: 42,
          overflow: "hidden", background: "rgba(23,25,21,0.94)", border: `1px solid ${colors.line}`,
          boxShadow: "0 40px 110px rgba(0,0,0,0.36)", transform: `translateY(${(1 - documentIn) * 100}px) scale(${0.92 + documentIn * 0.08})`, opacity: documentIn,
        }}
      >
        <AppBar label="new textbook upload" />
        <div style={{padding: 42, fontFamily: fonts.sans}}>
          <div style={{display: "flex", alignItems: "center", gap: 25}}>
            <div style={{width: 108, height: 138, borderRadius: 18, background: `linear-gradient(145deg, ${colors.cream}, #B9B3A8)`, color: colors.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fonts.mono, fontWeight: 700, fontSize: 24}}>PDF</div>
            <div>
              <div style={{color: colors.cream, fontSize: 29, fontWeight: 700}}>Human Anatomy Vol. II</div>
              <div style={{color: colors.muted, marginTop: 10, fontSize: 22}}>textbook.pdf · ready to learn</div>
            </div>
          </div>
          <div style={{marginTop: 56, height: 18, borderRadius: 99, background: "rgba(244,240,231,0.1)", overflow: "hidden"}}>
            <div style={{width: `${fill * 100}%`, height: "100%", borderRadius: 99, background: `linear-gradient(90deg, ${colors.mint}, ${colors.lime})`, boxShadow: `0 0 22px ${colors.mint}`}} />
          </div>
          <div style={{display: "flex", justifyContent: "space-between", marginTop: 18, fontFamily: fonts.mono, fontSize: 19, color: colors.muted}}>
            <span>{complete > 0.3 ? "indexed & searchable" : "reading pages…"}</span><span>{Math.round(fill * 100)}%</span>
          </div>
          <div style={{marginTop: 62, display: "flex", alignItems: "baseline", gap: 17, color: colors.cream}}>
            <span style={{fontFamily: fonts.display, fontSize: 92, fontWeight: 700, letterSpacing: -4}}>{count.toLocaleString()}</span>
            <span style={{fontSize: 28, color: colors.muted}}>pages</span>
          </div>
          <div style={{marginTop: 9, color: colors.mint, fontSize: 25, fontWeight: 600}}>Upload up to 3,000 pages</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ChatScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const question = pop(frame, fps, 6);
  const answer = pop(frame, fps, 38);
  const source = pop(frame, fps, 72);
  const cursor = ramp(frame, 78, 134);

  return (
    <AbsoluteFill>
      <Background accent={colors.lavender} />
      <div style={{position: "absolute", top: 126, left: SAFE.left, right: SAFE.right, ...blurIn(frame, fps)}}>
        <Eyebrow color={colors.lavender}>Smoother AI</Eyebrow>
        <div style={{marginTop: 26, color: colors.cream, fontFamily: fonts.display, fontSize: 77, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3}}>A conversation<br />that keeps moving.</div>
      </div>
      <div style={{position: "absolute", top: 570, left: 76, right: 76, bottom: 130, borderRadius: 42, overflow: "hidden", background: "rgba(23,25,21,0.95)", border: `1px solid ${colors.line}`, boxShadow: "0 45px 110px rgba(0,0,0,0.34)", fontFamily: fonts.sans}}>
        <AppBar label="gd · ask anything" />
        <div style={{padding: 34, display: "flex", flexDirection: "column", gap: 25}}>
          <div style={{alignSelf: "flex-end", maxWidth: 690, borderRadius: "26px 26px 8px 26px", padding: "24px 28px", background: colors.lime, color: colors.bg, fontSize: 28, lineHeight: 1.35, fontWeight: 600, opacity: question, transform: `translateX(${(1 - question) * 90}px)`}}>
            Explain the nephron simply — and use my textbook.
          </div>
          <div style={{alignSelf: "flex-start", maxWidth: 770, borderRadius: "26px 26px 26px 8px", padding: "25px 28px", background: "rgba(244,240,231,0.08)", border: `1px solid ${colors.line}`, color: colors.cream, fontSize: 27, lineHeight: 1.43, opacity: answer, transform: `translateY(${(1 - answer) * 34}px)`}}>
            Think of it as your kidney&apos;s sorting line: it filters blood, keeps what your body needs, and sends the rest away.
            <span style={{display: "inline-block", marginLeft: 5, width: 3, height: 27, verticalAlign: -4, background: colors.lime, opacity: cursor}} />
          </div>
          <div style={{alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 10, borderRadius: 99, padding: "12px 18px", background: `${colors.lavender}22`, color: colors.lavender, fontFamily: fonts.mono, fontSize: 17, opacity: source, transform: `translateY(${(1 - source) * 20}px)`}}>
            <span style={{width: 9, height: 9, borderRadius: 99, background: colors.lavender}} /> Your textbook · p. 87
          </div>
        </div>
        <div style={{position: "absolute", left: 32, right: 32, bottom: 31, height: 76, borderRadius: 21, border: `1px solid ${colors.line}`, padding: "0 19px", display: "flex", alignItems: "center", justifyContent: "space-between", color: colors.muted, fontSize: 23}}>
          Ask a follow-up… <span style={{width: 39, height: 39, borderRadius: 14, background: colors.lime, color: colors.bg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800}}>↑</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const DesignScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dash = pop(frame, fps, 8);
  const side = pop(frame, fps, 28);
  const cards = [0, 1, 2, 3].map((index) => pop(frame, fps, 52 + index * 12));

  return (
    <AbsoluteFill>
      <Background accent={colors.coral} />
      <div style={{position: "absolute", top: 148, left: SAFE.left, right: SAFE.right, ...blurIn(frame, fps)}}>
        <Eyebrow color={colors.coral}>New web app</Eyebrow>
        <div style={{marginTop: 26, color: colors.cream, fontFamily: fonts.display, fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3}}>A clearer place<br />to study.</div>
      </div>
      <div style={{position: "absolute", top: 570, left: 48, right: 48, height: 830, borderRadius: 42, overflow: "hidden", background: "rgba(23,25,21,0.96)", border: `1px solid ${colors.line}`, boxShadow: "0 46px 130px rgba(0,0,0,0.38)", transform: `scale(${0.92 + dash * 0.08}) translateY(${(1 - dash) * 90}px)`, opacity: dash, fontFamily: fonts.sans}}>
        <AppBar label="gd · your study space" />
        <div style={{display: "flex", height: 764}}>
          <div style={{width: 182, padding: 20, background: "rgba(244,240,231,0.035)", borderRight: `1px solid ${colors.line}`, opacity: side}}>
            {["Home", "Library", "My Coach", "Practice"].map((label, index) => <div key={label} style={{padding: "15px 13px", marginBottom: 9, borderRadius: 13, color: index === 0 ? colors.bg : colors.muted, background: index === 0 ? colors.lime : "transparent", fontSize: 17, fontWeight: 600}}>{label}</div>)}
          </div>
          <div style={{flex: 1, padding: 31}}>
            <div style={{color: colors.cream, fontSize: 35, fontWeight: 700}}>Good evening.</div>
            <div style={{color: colors.muted, marginTop: 9, fontSize: 18}}>Pick up exactly where you left off.</div>
            <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 17, marginTop: 28}}>
              {[["12", "documents"], ["4", "topics ready"], ["86%", "mastery"], ["7", "day streak"]].map(([value, label], index) => <div key={label} style={{borderRadius: 20, padding: 20, background: "rgba(244,240,231,0.06)", border: `1px solid ${colors.line}`, transform: `translateY(${(1 - cards[index]) * 38}px)`, opacity: cards[index]}}><div style={{color: index === 2 ? colors.lime : colors.cream, fontSize: 35, fontWeight: 700}}>{value}</div><div style={{color: colors.muted, fontSize: 15, marginTop: 7}}>{label}</div></div>)}
            </div>
            <div style={{marginTop: 22, borderRadius: 22, padding: 23, background: `linear-gradient(115deg, ${colors.lime}2e, ${colors.mint}10)`, border: `1px solid ${colors.lime}48`}}>
              <div style={{color: colors.lime, fontSize: 17, fontWeight: 700}}>CONTINUE LEARNING</div>
              <div style={{color: colors.cream, fontSize: 25, marginTop: 10, fontWeight: 600}}>Renal physiology · 18 min left</div>
              <div style={{height: 7, borderRadius: 99, overflow: "hidden", background: "rgba(244,240,231,0.14)", marginTop: 21}}><div style={{width: "68%", height: "100%", background: colors.lime}} /></div>
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const LeaderboardScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const header = pop(frame, fps, 4);
  const rows = [0, 1, 2, 3, 4].map((index) => pop(frame, fps, 33 + index * 11));
  const rank = Math.round(ramp(frame, 84, 158, [18, 3]));

  return (
    <AbsoluteFill>
      <Background accent={colors.lime} />
      <div style={{position: "absolute", top: 143, left: SAFE.left, right: SAFE.right, ...blurIn(frame, fps)}}>
        <Eyebrow>Leaderboards</Eyebrow>
        <div style={{marginTop: 25, color: colors.cream, fontFamily: fonts.display, fontSize: 77, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3}}>Turn progress<br />into momentum.</div>
      </div>
      <div style={{position: "absolute", top: 558, left: 76, right: 76, borderRadius: 42, padding: 32, background: "rgba(23,25,21,0.96)", border: `1px solid ${colors.line}`, boxShadow: "0 45px 115px rgba(0,0,0,0.38)", fontFamily: fonts.sans, opacity: header, transform: `translateY(${(1 - header) * 60}px)`}}>
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 25}}><div><div style={{color: colors.cream, fontSize: 32, fontWeight: 700}}>This week</div><div style={{color: colors.muted, fontSize: 19, marginTop: 7}}>Your course leaderboard</div></div><div style={{color: colors.lime, fontFamily: fonts.mono, fontSize: 22}}>TOP 10%</div></div>
        {["01 · 2,980 XP", "02 · 2,760 XP", `YOU · #${rank} · 2,640 XP`, "04 · 2,580 XP", "05 · 2,420 XP"].map((text, index) => {
          const you = index === 2;
          const xp = text.split(" · ")[1];
          return <div key={text} style={{height: 94, display: "flex", alignItems: "center", marginTop: 12, padding: "0 21px", borderRadius: 19, background: you ? `linear-gradient(90deg, ${colors.lime}, ${colors.mint})` : "rgba(244,240,231,0.055)", border: you ? "none" : `1px solid ${colors.line}`, color: you ? colors.bg : colors.cream, fontSize: 23, fontWeight: you ? 800 : 600, transform: `translateX(${(1 - rows[index]) * 80}px)`, opacity: rows[index]}}><span style={{width: 52, color: you ? colors.bg : colors.muted}}>{index + 1}</span><span style={{flex: 1}}>{you ? "Your study streak" : "Study squad"}</span><span style={{fontFamily: fonts.mono, fontSize: 19}}>{you ? `#${rank}` : xp}</span></div>;
        })}
        <div style={{marginTop: 27, padding: "20px 21px", borderRadius: 18, background: `${colors.lavender}1a`, color: colors.lavender, fontSize: 21, fontWeight: 600}}>Keep going — you&apos;re 120 XP from #2.</div>
      </div>
    </AbsoluteFill>
  );
};

const Opener: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logo = pop(frame, fps, 3);
  const title = pop(frame, fps, 18);
  const line = ramp(frame, 48, 82);
  return <AbsoluteFill style={{alignItems: "center", justifyContent: "center"}}><Background /><div style={{width: 820, textAlign: "center", color: colors.cream, fontFamily: fonts.display}}><div style={{fontSize: 37, letterSpacing: -1, fontWeight: 700, opacity: logo, transform: `scale(${0.8 + logo * 0.2})`}}>gd<span style={{color: colors.lime}}>·</span>online</div><div style={{marginTop: 60, fontSize: 91, lineHeight: 0.98, fontWeight: 700, letterSpacing: -5, opacity: title, transform: `translateY(${(1 - title) * 45}px)`}}>Your study<br />space just<br /><span style={{color: colors.lime}}>leveled up.</span></div><div style={{height: 3, width: 270 * line, margin: "48px auto 0", background: `linear-gradient(90deg, transparent, ${colors.lime}, transparent)`}} /></div></AbsoluteFill>;
};

const Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const main = pop(frame, fps, 5);
  const sub = pop(frame, fps, 35);
  return <AbsoluteFill style={{alignItems: "center", justifyContent: "center", textAlign: "center"}}><Background accent={colors.mint} /><div style={{position: "relative", color: colors.cream, fontFamily: fonts.display}}><div style={{fontSize: 94, fontWeight: 700, lineHeight: 0.98, letterSpacing: -5, opacity: main, transform: `scale(${0.88 + main * 0.12})`}}>Study smarter.<br /><span style={{color: colors.lime}}>Move faster.</span></div><div style={{marginTop: 45, color: colors.muted, fontFamily: fonts.sans, fontSize: 29, opacity: sub}}>Built for the way you actually learn.</div><div style={{display: "inline-flex", marginTop: 75, alignItems: "center", gap: 13, borderRadius: 99, padding: "19px 31px", background: colors.lime, color: colors.bg, fontFamily: fonts.sans, fontSize: 26, fontWeight: 800, opacity: sub}}>gd1.online <span style={{fontSize: 31}}>→</span></div></div></AbsoluteFill>;
};

/** 40-second vertical product-update film — entirely typography, UI and abstract graphics. */
export const ProductUpdateAd: React.FC = () => (
  <AbsoluteFill style={{background: colors.bg}}>
    <Sequence durationInFrames={120}><Opener /></Sequence>
    <Sequence from={120} durationInFrames={210}><UploadScene /></Sequence>
    <Sequence from={330} durationInFrames={210}><ChatScene /></Sequence>
    <Sequence from={540} durationInFrames={210}><DesignScene /></Sequence>
    <Sequence from={750} durationInFrames={210}><LeaderboardScene /></Sequence>
    <Sequence from={960} durationInFrames={240}><Closing /></Sequence>
  </AbsoluteFill>
);
