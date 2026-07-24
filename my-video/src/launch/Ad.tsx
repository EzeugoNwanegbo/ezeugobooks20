import React from "react";
import {AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig} from "remotion";
import {colors, fonts} from "./theme";

const W = 1080;
const H = 1920;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

const range = (frame: number, from: number, to: number, values: [number, number] = [0, 1]) =>
  interpolate(frame, [from, to], values, {easing: ease, extrapolateLeft: "clamp", extrapolateRight: "clamp"});

const inOut = (frame: number, start: number, end: number, fade = 18) =>
  Math.min(range(frame, start, start + fade), 1 - range(frame, end - fade, end));

const pop = (frame: number, fps: number, delay = 0, stiffness = 115) =>
  spring({frame: Math.max(0, frame - delay), fps, config: {damping: 16, stiffness, mass: 0.72}});

const Glass: React.FC<{children: React.ReactNode; style?: React.CSSProperties; tone?: "blue" | "orange" | "gold"}> = ({children, style, tone = "blue"}) => {
  const glow = tone === "orange" ? colors.orange : tone === "gold" ? colors.gold : colors.blue;
  return <div style={{borderRadius: 30, border: `1px solid ${colors.line}`, background: `linear-gradient(145deg, rgba(30,41,59,0.85), ${colors.panel})`, boxShadow: `0 26px 70px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.09), 0 0 54px ${glow}14`, backdropFilter: "blur(18px)", ...style}}>{children}</div>;
};

const StageBackground: React.FC<{orange?: number; blue?: number}> = ({orange = 0.23, blue = 0.32}) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 80) * 34;
  return <AbsoluteFill style={{overflow: "hidden", background: `radial-gradient(circle at ${18 + drift / 15}% ${18 - drift / 20}%, rgba(37,99,235,${blue}), transparent 31%), radial-gradient(circle at ${82 - drift / 18}% ${78 + drift / 25}%, rgba(249,115,22,${orange}), transparent 35%), linear-gradient(150deg, #020617, ${colors.black} 53%, #070A12)`}}>
    <div style={{position: "absolute", inset: -300, backgroundImage: "linear-gradient(rgba(148,163,184,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.045) 1px, transparent 1px)", backgroundSize: "80px 80px", transform: `perspective(900px) rotateX(62deg) translateY(${420 + drift}px)`, maskImage: "linear-gradient(to bottom, transparent, black 25%, transparent 88%)"}} />
    {Array.from({length: 40}).map((_, index) => {
      const x = (index * 139 + 32) % W;
      const y = (index * 247 + frame * (0.38 + (index % 4) * 0.08)) % H;
      const size = index % 5 === 0 ? 5 : 2;
      return <span key={index} style={{position: "absolute", left: x, top: y, width: size, height: size, borderRadius: 99, background: index % 3 === 0 ? colors.blueBright : index % 5 === 0 ? colors.orangeBright : "rgba(248,250,252,0.42)", boxShadow: `0 0 ${size * 4}px currentColor`, opacity: 0.24 + (index % 4) * 0.13}} />;
    })}
  </AbsoluteFill>;
};

const Logo: React.FC<{opacity?: number; scale?: number}> = ({opacity = 1, scale = 1}) => <div style={{display: "inline-flex", alignItems: "center", gap: 12, color: colors.ink, fontFamily: fonts.display, fontSize: 42, fontWeight: 800, letterSpacing: -2, opacity, transform: `scale(${scale})`}}><span style={{width: 34, height: 34, display: "inline-block", borderRadius: 12, background: `linear-gradient(135deg, ${colors.blueBright}, ${colors.blue})`, boxShadow: `0 0 32px ${colors.blue}`}} />g&amp;d</div>;

const Eyebrow: React.FC<{children: React.ReactNode; color?: string}> = ({children, color = colors.blueBright}) => <div style={{display: "flex", alignItems: "center", gap: 13, color, fontFamily: fonts.mono, fontSize: 20, letterSpacing: 3.2, fontWeight: 600, textTransform: "uppercase"}}><span style={{width: 28, height: 2, background: color, boxShadow: `0 0 12px ${color}`}} />{children}</div>;

const Headline: React.FC<{children: React.ReactNode; frame: number; fps: number; delay?: number; size?: number; accent?: string}> = ({children, frame, fps, delay = 0, size = 76, accent}) => {
  const entry = pop(frame, fps, delay);
  return <div style={{marginTop: 28, maxWidth: 900, color: colors.ink, fontFamily: fonts.display, fontSize: size, lineHeight: 1.01, fontWeight: 700, letterSpacing: -3.2, opacity: entry, transform: `translateY(${(1 - entry) * 48}px)`, filter: `blur(${(1 - entry) * 8}px)`}}>{accent ? <>{children}<span style={{color: accent}}>.</span></> : children}</div>;
};

const AppHeader: React.FC<{name?: string}> = ({name = "G&D · Learning workspace"}) => <div style={{height: 58, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${colors.line}`, color: colors.ink, fontFamily: fonts.sans, fontWeight: 700, fontSize: 17}}><div style={{display: "flex", gap: 9, alignItems: "center"}}><span style={{width: 17, height: 17, borderRadius: 6, background: colors.blue, boxShadow: `0 0 16px ${colors.blue}`}} />{name}</div><div style={{display: "flex", gap: 7}}>{[0, 1, 2].map((index) => <span key={index} style={{width: 7, height: 7, borderRadius: 20, background: "rgba(248,250,252,0.42)"}} />)}</div></div>;

const Flame: React.FC<{scale?: number}> = ({scale = 1}) => <div style={{position: "relative", width: 80 * scale, height: 98 * scale, filter: `drop-shadow(0 0 ${26 * scale}px ${colors.orange})`}}><div style={{position: "absolute", left: 16 * scale, width: 52 * scale, height: 80 * scale, borderRadius: "56% 44% 54% 46% / 63% 61% 39% 37%", background: `linear-gradient(160deg, ${colors.orangeBright}, ${colors.orange} 55%, #EA580C)`, transform: "rotate(8deg)"}} /><div style={{position: "absolute", bottom: 2 * scale, left: 28 * scale, width: 29 * scale, height: 42 * scale, borderRadius: "58% 42% 55% 45%", background: "#FDE68A", transform: "rotate(-8deg)"}} /></div>;

const Ring: React.FC<{percent: number; size?: number; color?: string; label?: string}> = ({percent, size = 154, color = colors.blueBright, label}) => <div style={{width: size, height: size, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: `conic-gradient(${color} ${percent * 3.6}deg, rgba(148,163,184,0.13) 0deg)`, boxShadow: `0 0 34px ${color}36`}}><div style={{width: size - 17, height: size - 17, borderRadius: "50%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: colors.surface, color: colors.ink, fontFamily: fonts.display, fontSize: size / 4.7, fontWeight: 700}}>{Math.round(percent)}%{label && <span style={{marginTop: 3, color: colors.muted, fontFamily: fonts.sans, fontSize: size / 11, fontWeight: 500}}>{label}</span>}</div></div>;

const Opener: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logo = pop(frame, fps, 34);
  const first = inOut(frame, 88, 210, 20);
  const second = inOut(frame, 238, 348, 20);
  const pattern = range(frame, 0, 130);
  return <AbsoluteFill><StageBackground orange={0.08} blue={0.18} />
    {Array.from({length: 9}).map((_, index) => <div key={index} style={{position: "absolute", left: 130 + (index % 3) * 330, top: 420 + Math.floor(index / 3) * 260, width: 260, height: 1, background: `linear-gradient(90deg, transparent, ${colors.blueBright}, transparent)`, opacity: pattern * (0.24 + index / 65), transform: `rotate(${index * 40 - 35}deg) scaleX(${pattern})`, boxShadow: `0 0 16px ${colors.blue}`}} />)}
    <div style={{position: "absolute", top: 562, left: 0, right: 0, textAlign: "center"}}><Logo opacity={logo} scale={0.75 + logo * 0.25} /></div>
    <div style={{position: "absolute", top: 800, left: 70, right: 70, color: colors.ink, textAlign: "center", fontFamily: fonts.display, fontSize: 79, lineHeight: 1.04, letterSpacing: -3, fontWeight: 700, opacity: first, transform: `translateY(${(1 - first) * 28}px)`}}>This isn&apos;t just an update.</div>
    <div style={{position: "absolute", top: 800, left: 70, right: 70, color: colors.ink, textAlign: "center", fontFamily: fonts.display, fontSize: 77, lineHeight: 1.04, letterSpacing: -3, fontWeight: 700, opacity: second, transform: `translateY(${(1 - second) * 28}px)`}}>It&apos;s a completely<br /><span style={{color: colors.blueBright}}>new way to learn.</span></div>
  </AbsoluteFill>;
};

const RedesignScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const shell = pop(frame, fps, 12);
  const menu = pop(frame, fps, 42);
  const card = [0, 1, 2, 3].map((index) => pop(frame, fps, 66 + index * 13));
  const words = ["Faster.", "Cleaner.", "Smarter."];
  const active = Math.min(2, Math.floor(Math.max(0, frame - 250) / 62));
  return <AbsoluteFill><StageBackground />
    <div style={{position: "absolute", top: 120, left: 74, right: 74}}><Eyebrow>new G&amp;D</Eyebrow><Headline frame={frame} fps={fps} size={70} accent={colors.blueBright}>Completely redesigned</Headline><div style={{marginTop: 21, maxWidth: 765, color: colors.muted, fontFamily: fonts.sans, fontSize: 24, lineHeight: 1.38, opacity: pop(frame, fps, 38), transform: `translateY(${(1 - pop(frame, fps, 38)) * 20}px)`}}>For people who want to understand what they&apos;re reading — not just cram it.</div></div>
    <Glass style={{position: "absolute", top: 495, left: 50, width: 980, height: 860, overflow: "hidden", opacity: shell, transform: `translateY(${(1 - shell) * 92}px) scale(${0.93 + shell * 0.07})`}}><AppHeader />
      <div style={{display: "flex", height: 802}}><div style={{width: 180, padding: 18, borderRight: `1px solid ${colors.line}`, opacity: menu}}>{["Overview", "Library", "My Coach", "Practice"].map((item, index) => <div key={item} style={{padding: "15px 14px", marginBottom: 7, borderRadius: 13, background: index === 0 ? `${colors.blue}66` : "transparent", color: index === 0 ? colors.ink : colors.muted, fontFamily: fonts.sans, fontSize: 16, fontWeight: 600}}>{item}</div>)}</div>
        <div style={{flex: 1, padding: 28, fontFamily: fonts.sans}}><div style={{color: colors.ink, fontSize: 32, fontWeight: 700}}>Your study space</div><div style={{color: colors.muted, marginTop: 7, fontSize: 17}}>Everything important, right on time.</div><div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15, marginTop: 29}}>{[["12", "topics"], ["86%", "mastery"], ["7", "day streak"], ["3", "goals ready"]].map(([value, label], index) => <div key={label} style={{padding: 19, borderRadius: 20, background: "rgba(248,250,252,0.055)", border: `1px solid ${colors.line}`, opacity: card[index], transform: `translateY(${(1 - card[index]) * 35}px)`}}><div style={{color: index === 1 ? colors.blueBright : colors.ink, fontSize: 34, fontWeight: 700}}>{value}</div><div style={{color: colors.muted, marginTop: 6, fontSize: 15}}>{label}</div></div>)}</div>
          <div style={{marginTop: 19, padding: 22, borderRadius: 22, border: `1px solid ${colors.blue}66`, background: `linear-gradient(105deg, ${colors.blue}3b, transparent)`}}><div style={{color: colors.blueBright, fontSize: 15, fontWeight: 700, letterSpacing: 1.6}}>CONTINUE LEARNING</div><div style={{color: colors.ink, marginTop: 9, fontSize: 24, fontWeight: 600}}>Renal physiology</div><div style={{height: 7, borderRadius: 10, overflow: "hidden", background: "rgba(248,250,252,0.15)", marginTop: 19}}><div style={{width: "68%", height: "100%", background: `linear-gradient(90deg, ${colors.blue}, ${colors.blueBright})`}} /></div></div></div></div>
    </Glass>
    <div style={{position: "absolute", left: 74, right: 74, bottom: 180, textAlign: "center", fontFamily: fonts.display, fontSize: 46, fontWeight: 700}}>{words.map((word, index) => <span key={word} style={{position: "absolute", left: 0, right: 0, opacity: active === index ? range(frame - (250 + index * 62), 0, 18) : 0, color: index === 2 ? colors.orangeBright : colors.ink}}>{word}</span>)}</div>
  </AbsoluteFill>;
};

const StreaksScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const flame = pop(frame, fps, 12);
  const milestone = Math.min(3, Math.floor(Math.max(0, frame - 85) / 62));
  const days = [1, 7, 30, 100];
  const calendar = range(frame, 185, 320);
  return <AbsoluteFill><StageBackground orange={0.35} blue={0.18} />
    <div style={{position: "absolute", top: 130, left: 74}}><Eyebrow color={colors.orangeBright}>Daily streaks</Eyebrow><Headline frame={frame} fps={fps} size={70} accent={colors.orangeBright}>Build consistency</Headline><div style={{marginTop: 13, color: colors.muted, fontFamily: fonts.sans, fontSize: 25}}>One day at a time.</div></div>
    <div style={{position: "absolute", top: 590, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", opacity: flame, transform: `scale(${0.75 + flame * 0.25})`}}><Flame scale={1.55} /><div style={{color: colors.ink, marginTop: 24, fontFamily: fonts.display, fontSize: 55, fontWeight: 700}}>{days[milestone]} day{milestone === 0 ? "" : "s"}</div><div style={{color: colors.orangeBright, marginTop: 8, fontFamily: fonts.mono, fontSize: 19, letterSpacing: 2}}>CURRENT STREAK</div></div>
    <Glass tone="orange" style={{position: "absolute", left: 74, right: 74, bottom: 136, padding: 27}}><div style={{display: "flex", justifyContent: "space-between", alignItems: "center", color: colors.ink, fontFamily: fonts.sans, fontSize: 21, fontWeight: 700}}><span>July · study calendar</span><span style={{color: colors.orangeBright}}>100 days</span></div><div style={{display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12, marginTop: 24}}>{Array.from({length: 28}).map((_, index) => {const done = index < Math.round(calendar * 24); return <div key={index} style={{height: 42, borderRadius: 12, background: done ? `linear-gradient(135deg, ${colors.orange}, ${colors.orangeBright})` : "rgba(148,163,184,0.13)", boxShadow: done ? `0 0 18px ${colors.orange}55` : "none", transform: `scale(${done ? 1 : 0.82})`}} />;})}</div></Glass>
  </AbsoluteFill>;
};

const CoachScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const shell = pop(frame, fps, 8);
  const rewards = [25, 50, 100, 250];
  const count = Math.round(range(frame, 55, 290, [0, 425]));
  return <AbsoluteFill><StageBackground orange={0.2} blue={0.38} />
    <div style={{position: "absolute", top: 124, left: 74}}><Eyebrow>My Coach</Eyebrow><Headline frame={frame} fps={fps} size={68} accent={colors.blueBright}>Every session earns rewards</Headline></div>
    <Glass style={{position: "absolute", top: 490, left: 74, right: 74, padding: 30, opacity: shell, transform: `translateY(${(1 - shell) * 70}px)`}}><AppHeader name="My Coach · rewards" /><div style={{paddingTop: 30, display: "flex", alignItems: "center", justifyContent: "space-between"}}><div><div style={{color: colors.muted, fontFamily: fonts.sans, fontSize: 19}}>Coach Points</div><div style={{color: colors.ink, marginTop: 7, fontFamily: fonts.display, fontSize: 82, fontWeight: 700, letterSpacing: -4}}>{count}</div><div style={{color: colors.blueBright, marginTop: 6, fontFamily: fonts.mono, fontSize: 17}}>+250 THIS SESSION</div></div><Ring percent={range(frame, 40, 270, [0, 78])} label="LEVEL 8" /></div>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15, marginTop: 35}}>{rewards.map((reward, index) => {const entry = pop(frame, fps, 55 + index * 21); return <div key={reward} style={{borderRadius: 20, padding: "21px 20px", background: "rgba(248,250,252,0.06)", border: `1px solid ${colors.line}`, opacity: entry, transform: `scale(${0.82 + entry * 0.18})`}}><div style={{color: colors.blueBright, fontFamily: fonts.mono, fontSize: 17}}>SESSION COMPLETE</div><div style={{color: colors.ink, marginTop: 10, fontFamily: fonts.display, fontSize: 43, fontWeight: 700}}>+{reward}</div></div>;})}</div>
      <div style={{marginTop: 26, borderRadius: 18, padding: "20px 22px", display: "flex", alignItems: "center", gap: 16, background: `${colors.orange}1e`, border: `1px solid ${colors.orange}4e`, color: colors.ink, fontFamily: fonts.sans, fontSize: 20, fontWeight: 600}}><span style={{width: 33, height: 33, borderRadius: 12, background: colors.orange, boxShadow: `0 0 20px ${colors.orange}`}} />Achievement unlocked · Focused learner</div>
    </Glass>
  </AbsoluteFill>;
};

const LeaderboardScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const ranks = [128, 57, 14, 3, 1];
  const active = Math.min(4, Math.floor(Math.max(0, frame - 48) / 54));
  const enter = pop(frame, fps, 10);
  return <AbsoluteFill><StageBackground orange={0.28} blue={0.24} />
    <div style={{position: "absolute", top: 126, left: 74}}><Eyebrow color={colors.gold}>Leaderboards</Eyebrow><Headline frame={frame} fps={fps} size={68} accent={colors.gold}>Stay motivated</Headline></div>
    <Glass tone="gold" style={{position: "absolute", top: 480, left: 76, right: 76, padding: 30, opacity: enter, transform: `translateY(${(1 - enter) * 70}px)`}}><div style={{display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 24, borderBottom: `1px solid ${colors.line}`, color: colors.ink, fontFamily: fonts.sans}}><div style={{fontSize: 29, fontWeight: 700}}>This week</div><div style={{color: colors.gold, fontFamily: fonts.mono, fontSize: 17}}>TOP 1%</div></div>
      <div style={{marginTop: 28, display: "grid", gap: 13}}>{ranks.map((rank, index) => {const visible = index <= active; const current = index === active; return <React.Fragment key={rank}><div style={{height: 92, display: "flex", alignItems: "center", borderRadius: 20, padding: "0 24px", background: rank === 1 ? `linear-gradient(100deg, ${colors.gold}, ${colors.orangeBright})` : current ? `${colors.blue}66` : "rgba(248,250,252,0.055)", border: rank === 1 ? "none" : `1px solid ${colors.line}`, color: rank === 1 ? colors.black : colors.ink, opacity: visible ? 1 : 0.22, transform: `scale(${current ? 1.035 : 1})`, boxShadow: rank === 1 ? `0 0 48px ${colors.gold}77` : "none", fontFamily: fonts.display, fontSize: 34, fontWeight: 700}}><span style={{width: 120}}>#{rank}</span><span style={{flex: 1, fontFamily: fonts.sans, fontSize: 20, fontWeight: 600}}>{rank === 1 ? "You · top of the board" : "Climbing…"}</span><span style={{fontFamily: fonts.mono, fontSize: 17}}>{rank === 1 ? "2,980 XP" : "↑"}</span></div>{index < ranks.length - 1 && <div style={{height: 10, marginLeft: 60, borderLeft: `2px solid ${colors.blueBright}`, opacity: visible ? 0.8 : 0.15}} />}</React.Fragment>;})}</div></Glass>
    <div style={{position: "absolute", bottom: 152, left: 0, right: 0, textAlign: "center", fontFamily: fonts.display, fontSize: 42, fontWeight: 700, color: colors.ink}}>{["Compete.", "Improve.", "Stay motivated."].map((word, index) => <span key={word} style={{position: "absolute", left: 0, right: 0, opacity: active === index + 1 ? 1 : 0, color: index === 2 ? colors.gold : colors.ink}}>{word}</span>)}</div>
  </AbsoluteFill>;
};

const ProgressScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const dashboard = pop(frame, fps, 8);
  const bars = [64, 86, 47, 93];
  return <AbsoluteFill><StageBackground orange={0.18} blue={0.36} />
    <div style={{position: "absolute", top: 120, left: 74}}><Eyebrow>Progress &amp; growth</Eyebrow><Headline frame={frame} fps={fps} size={66} accent={colors.blueBright}>Track every milestone</Headline></div>
    <Glass style={{position: "absolute", top: 450, left: 74, right: 74, padding: 28, opacity: dashboard, transform: `scale(${0.92 + dashboard * 0.08})`}}><div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}><div><div style={{color: colors.ink, fontFamily: fonts.sans, fontSize: 28, fontWeight: 700}}>Your learning dashboard</div><div style={{color: colors.muted, marginTop: 7, fontFamily: fonts.sans, fontSize: 17}}>A clearer picture of your growth.</div></div><Ring percent={range(frame, 25, 200, [0, 82])} size={126} label="GOAL" /></div>
      <div style={{height: 210, marginTop: 34, display: "flex", alignItems: "flex-end", gap: 21, padding: "0 12px", borderBottom: `1px solid ${colors.line}`}}>{bars.map((height, index) => <div key={height} style={{flex: 1, display: "flex", height: "100%", alignItems: "flex-end"}}><div style={{width: "100%", height: `${height * range(frame, 35 + index * 18, 180 + index * 18)}%`, borderRadius: "13px 13px 3px 3px", background: index === 3 ? `linear-gradient(180deg, ${colors.orangeBright}, ${colors.orange})` : `linear-gradient(180deg, ${colors.blueBright}, ${colors.blue})`, boxShadow: `0 0 25px ${index === 3 ? colors.orange : colors.blue}55`}} /></div>)}</div>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15, marginTop: 26}}>{[["4 / 4", "weekly goals"], ["8", "badges unlocked"]].map(([value, label], index) => <div key={label} style={{padding: 21, borderRadius: 19, background: index === 0 ? `${colors.blue}28` : `${colors.orange}20`, border: `1px solid ${index === 0 ? colors.blue : colors.orange}55`}}><div style={{color: colors.ink, fontFamily: fonts.display, fontSize: 37, fontWeight: 700}}>{value}</div><div style={{color: colors.muted, marginTop: 5, fontFamily: fonts.sans, fontSize: 16}}>{label}</div></div>)}</div>
    </Glass>
    <div style={{position: "absolute", bottom: 135, left: 80, right: 80, textAlign: "center", color: colors.ink, fontFamily: fonts.display, fontSize: 40, lineHeight: 1.1, fontWeight: 700, opacity: range(frame, 190, 228)}}>Celebrate every milestone.</div>
  </AbsoluteFill>;
};

const Finale: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logo = pop(frame, fps, 125);
  const first = inOut(frame, 18, 88, 13);
  const second = inOut(frame, 92, 164, 13);
  const last = inOut(frame, 172, 235, 10);
  const items = [[-260, -240, colors.blue], [250, -250, colors.orange], [-300, 190, colors.blueBright], [290, 200, colors.gold], [0, -345, colors.orangeBright]];
  return <AbsoluteFill><StageBackground orange={0.16} blue={0.2} />
    {items.map(([x, y, color], index) => {const move = range(frame, 0, 128); return <Glass key={index} tone={index % 2 ? "orange" : "blue"} style={{position: "absolute", left: 450 + Number(x) * (1 - move), top: 850 + Number(y) * (1 - move), width: 160, height: 106, borderRadius: 22, background: `${String(color)}32`, opacity: 0.3 + move * 0.7, transform: `rotate(${Number(x) / 14 * (1 - move)}deg) scale(${0.7 + move * 0.3})`}}>{null}</Glass>;})}
    <div style={{position: "absolute", top: 530, left: 70, right: 70, color: colors.ink, textAlign: "center", fontFamily: fonts.display, fontSize: 65, lineHeight: 1.08, fontWeight: 700, opacity: first}}>This isn&apos;t just an update.</div>
    <div style={{position: "absolute", top: 530, left: 70, right: 70, color: colors.ink, textAlign: "center", fontFamily: fonts.display, fontSize: 65, lineHeight: 1.08, fontWeight: 700, opacity: second}}>It&apos;s a completely<br /><span style={{color: colors.blueBright}}>new way to learn.</span></div>
    <div style={{position: "absolute", top: 760, left: 0, right: 0, textAlign: "center"}}><Logo opacity={logo} scale={0.72 + logo * 0.28} /></div>
    <div style={{position: "absolute", top: 1090, left: 0, right: 0, color: colors.ink, textAlign: "center", fontFamily: fonts.display, fontSize: 52, fontWeight: 700, letterSpacing: -2, opacity: last}}>The New G&amp;D.</div>
    <div style={{position: "absolute", top: 870, left: 190, right: 190, height: 2, background: `linear-gradient(90deg, transparent, ${colors.blueBright}, ${colors.orangeBright}, transparent)`, opacity: logo, boxShadow: `0 0 28px ${colors.blue}`}} />
  </AbsoluteFill>;
};

/** Premium G&D launch film: 40s, 9:16, 4K, 60fps, UI/typography only. */
export const PremiumLaunchAd: React.FC = () => <AbsoluteFill style={{background: colors.black}}><div style={{position: "relative", width: W, height: H, overflow: "hidden", transform: "scale(2)", transformOrigin: "top left"}}><Sequence durationInFrames={360}><Opener /></Sequence><Sequence from={360} durationInFrames={480}><RedesignScene /></Sequence><Sequence from={840} durationInFrames={360}><StreaksScene /></Sequence><Sequence from={1200} durationInFrames={360}><CoachScene /></Sequence><Sequence from={1560} durationInFrames={360}><LeaderboardScene /></Sequence><Sequence from={1920} durationInFrames={300}><ProgressScene /></Sequence><Sequence from={2220} durationInFrames={180}><Finale /></Sequence></div></AbsoluteFill>;
