import React from "react";
import {
  AbsoluteFill,
  Composition,
  Sequence,
  interpolate,
  registerRoot,
  spring,
  useCurrentFrame,
} from "remotion";

const C = {
  ink: "#eee6d8",
  copper: "#c1a07a",
  muted: "#aaa496",
  panel: "#1b1b18",
};
const pop = (f: number, delay = 0) =>
  spring({ frame: f - delay, fps: 30, config: { damping: 20, stiffness: 95 } });
const Arrow = () => (
  <svg width="50" height="50" viewBox="0 0 50 50" fill="none">
    <path
      d="M10 25h30M27 12l13 13-13 13"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const Panel: React.FC<{
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, style }) => {
  const f = useCurrentFrame(),
    p = pop(f, delay);
  return (
    <div
      style={{
        padding: 40,
        background: C.panel,
        border: "2px solid #eee6d82a",
        borderRadius: 30,
        boxShadow: "0 30px 60px #0005",
        opacity: p,
        transform: `translateY(${(1 - p) * 90}px) scale(${0.94 + 0.06 * p})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
const Stage: React.FC<{
  label: string;
  title: React.ReactNode;
  duration: number;
  children: React.ReactNode;
}> = ({ label, title, duration, children }) => {
  const f = useCurrentFrame();
  const fade = interpolate(
    f,
    [0, 10, duration - 9, duration - 1],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return (
    <AbsoluteFill style={{ padding: "260px 85px 240px", opacity: fade }}>
      <div
        style={{
          color: C.copper,
          fontSize: 25,
          letterSpacing: 4,
          marginBottom: 35,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 88,
          fontWeight: 700,
          letterSpacing: -4,
          lineHeight: 1.06,
          transform: `translateY(${(1 - pop(f)) * 40}px)`,
        }}
      >
        {title}
      </div>
      <div style={{ marginTop: 65 }}>{children}</div>
    </AbsoluteFill>
  );
};
const Hook = () => {
  const f = useCurrentFrame();
  return (
    <Stage
      label="FOR LAW & MEDICINE STUDENTS"
      title={
        <>
          Read it twice.
          <br />
          <span style={{ color: C.copper }}>
            Brain still
            <br />
            buffering?
          </span>
        </>
      }
      duration={120}
    >
      {["Too many pages.", "Too many tabs.", "Not enough clarity."].map(
        (t, i) => (
          <Panel
            key={t}
            delay={12 + i * 10}
            style={{
              padding: "34px 40px",
              fontSize: 43,
              marginBottom: 22,
              transform: `translateY(${(1 - pop(f, 12 + i * 10)) * 90}px) rotate(${(i - 1) * 3}deg)`,
              background: i === 2 ? C.copper : C.panel,
              color: i === 2 ? "#171410" : C.ink,
            }}
          >
            <span style={{ opacity: 0.6, marginRight: 30, fontSize: 24 }}>
              0{i + 1}
            </span>
            {t}
          </Panel>
        ),
      )}
      <div
        style={{
          fontSize: 36,
          lineHeight: 1.4,
          color: C.muted,
          marginTop: 45,
          opacity: pop(f, 45),
        }}
      >
        Meet G&amp;D.
        <br />
        Let’s connect the dots.
      </div>
    </Stage>
  );
};
const Library = () => (
  <Stage
    label="01 / BRING YOUR MATERIAL"
    title={
      <>
        Your textbooks.
        <br />
        Your notes.
        <br />
        <span style={{ color: C.copper }}>One workspace.</span>
      </>
    }
    duration={150}
  >
    <Panel delay={10}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: 30,
          borderBottom: "2px solid #eee6d825",
        }}
      >
        <span style={{ fontSize: 38, fontWeight: 700 }}>Your library</span>
        <span style={{ color: C.copper, fontSize: 42 }}>+</span>
      </div>
      {[
        ["PDF", "Cardiovascular physiology"],
        ["SLIDES", "Contract law"],
        ["NOTES", "Revision notes"],
      ].map(([type, title], i) => (
        <Panel
          key={title}
          delay={25 + i * 14}
          style={{
            marginTop: 24,
            padding: "28px 24px",
            display: "flex",
            alignItems: "center",
            gap: 25,
            boxShadow: "none",
          }}
        >
          <div
            style={{
              width: 100,
              height: 110,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "#c1a07a20",
              color: C.copper,
              borderRadius: 14,
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {type}
          </div>
          <div style={{ fontSize: 30, lineHeight: 1.3 }}>{title}</div>
        </Panel>
      ))}
    </Panel>
    <div
      style={{ fontSize: 34, color: C.muted, lineHeight: 1.4, marginTop: 40 }}
    >
      Keep what you’re studying together.
    </div>
  </Stage>
);
const Chat = () => {
  const f = useCurrentFrame();
  return (
    <Stage
      label="02 / ASK THE QUESTION"
      title={
        <>
          “Explain this
          <br />
          <span style={{ color: C.copper }}>in simple terms.”</span>
        </>
      }
      duration={180}
    >
      <Panel delay={8}>
        <div style={{ fontSize: 26, color: C.copper, marginBottom: 40 }}>
          G&amp;D / STUDY CHAT
        </div>
        <div
          style={{
            fontSize: 34,
            lineHeight: 1.4,
            background: "#302a23",
            padding: 30,
            borderRadius: "24px 24px 0 24px",
            marginLeft: 50,
          }}
        >
          Why does the heart beat faster during exercise?
        </div>
        <div
          style={{
            opacity: pop(f, 35),
            fontSize: 36,
            lineHeight: 1.5,
            marginTop: 45,
          }}
        >
          Your muscles need more oxygen. Your heart pumps more blood to meet
          that demand.
        </div>
        <div
          style={{
            opacity: pop(f, 65),
            fontSize: 24,
            lineHeight: 1.4,
            color: C.copper,
            marginTop: 35,
            paddingTop: 25,
            borderTop: "2px solid #eee6d825",
          }}
        >
          SOURCE / Cardiovascular physiology
          <br />
          Exercise response
        </div>
        <div style={{ fontSize: 19, color: C.muted, marginTop: 30 }}>
          Illustrative conversation
        </div>
      </Panel>
      <div
        style={{ fontSize: 34, color: C.muted, lineHeight: 1.4, marginTop: 40 }}
      >
        Ask follow-ups. Connect the dots.
      </div>
    </Stage>
  );
};
const Practice = () => {
  const f = useCurrentFrame();
  return (
    <Stage
      label="04 / MAKE IT STICK"
      title={
        <>
          Understand it.
          <br />
          <span style={{ color: C.copper }}>Then practise it.</span>
        </>
      }
      duration={150}
    >
      <Panel delay={10}>
        <div style={{ fontSize: 26, color: C.copper, marginBottom: 34 }}>
          PRACTICE / EXAMPLE QUESTION
        </div>
        <div style={{ fontSize: 37, lineHeight: 1.3, marginBottom: 35 }}>
          Cardiac output equals…
        </div>
        {["Heart rate × stroke volume", "Heart rate ÷ stroke volume"].map(
          (t, i) => (
            <div
              key={t}
              style={{
                padding: 30,
                marginTop: 20,
                borderRadius: 18,
                border: `2px solid ${i === 0 && f > 50 ? C.copper : "#eee6d825"}`,
                background: i === 0 && f > 50 ? "#c1a07a25" : "transparent",
                fontSize: 29,
              }}
            >
              <span style={{ color: C.copper, marginRight: 22 }}>
                {i === 0 ? "A" : "B"}
              </span>
              {t}
            </div>
          ),
        )}
        <div
          style={{
            fontSize: 28,
            color: C.copper,
            marginTop: 30,
            opacity: pop(f, 55),
          }}
        >
          Correct. Now you’re connecting the dots.
        </div>
      </Panel>
      <div style={{ display: "flex", gap: 18, marginTop: 40 }}>
        {["Roadmaps", "Practice", "Flashcards"].map((t, i) => (
          <Panel
            key={t}
            delay={25 + i * 8}
            style={{
              padding: "24px 20px",
              fontSize: 24,
              flex: 1,
              textAlign: "center",
            }}
          >
            {t}
          </Panel>
        ))}
      </div>
    </Stage>
  );
};
const Law = () => {
  const f = useCurrentFrame();
  return (
    <Stage
      label="03 / LAW, WITHOUT THE FOG"
      title={
        <>
          Big legal ideas.
          <br />
          <span style={{ color: C.copper }}>Clearer distinctions.</span>
        </>
      }
      duration={150}
    >
      <Panel delay={8}>
        <div style={{ fontSize: 26, color: C.copper, marginBottom: 40 }}>
          G&amp;D / CONTRACT LAW
        </div>
        <div
          style={{
            fontSize: 34,
            lineHeight: 1.4,
            background: "#302a23",
            padding: 30,
            borderRadius: "24px 24px 0 24px",
            marginLeft: 50,
          }}
        >
          An offer or an invitation to treat?
        </div>
        <div
          style={{
            opacity: pop(f, 30),
            fontSize: 36,
            lineHeight: 1.5,
            marginTop: 45,
          }}
        >
          An offer may become binding when accepted.
          <br />
          <br />
          An invitation to treat invites someone else to make an offer.
        </div>
        <div
          style={{
            opacity: pop(f, 50),
            fontSize: 24,
            color: C.copper,
            marginTop: 35,
            paddingTop: 25,
            borderTop: "2px solid #eee6d825",
          }}
        >
          SOURCE / Foundations of contract law
        </div>
        <div style={{ fontSize: 19, color: C.muted, marginTop: 30 }}>
          Illustrative conversation
        </div>
      </Panel>
    </Stage>
  );
};
const Finale = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        padding: "310px 90px 240px",
        textAlign: "center",
        opacity: interpolate(f, [0, 12], [0, 1], { extrapolateRight: "clamp" }),
      }}
    >
      <div style={{ color: C.copper, fontSize: 25, letterSpacing: 4 }}>
        YOUR NEXT “I GET IT” STARTS HERE
      </div>
      <div
        style={{
          fontSize: 190,
          fontWeight: 700,
          letterSpacing: -12,
          marginTop: 100,
          transform: `scale(${0.8 + 0.2 * pop(f, 8)})`,
        }}
      >
        G&amp;D
      </div>
      <div
        style={{
          fontSize: 76,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: -3,
          marginTop: 70,
        }}
      >
        Less searching.
        <br />
        <span style={{ color: C.copper }}>More clarity.</span>
      </div>
      <div
        style={{ fontSize: 35, color: C.muted, lineHeight: 1.5, marginTop: 45 }}
      >
        For law and medicine.
        <br />
        Your material. Your way forward.
      </div>
      <Panel
        delay={22}
        style={{
          background: C.copper,
          color: "#171410",
          marginTop: 95,
          padding: "36px 38px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          fontSize: 65,
          fontWeight: 700,
        }}
      >
        gd1.online <Arrow />
      </Panel>
      <div style={{ fontSize: 32, marginTop: 35, opacity: pop(f, 35) }}>
        Visit the website. Start your workspace.
      </div>
    </AbsoluteFill>
  );
};
const Social = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: "#0b0b0a",
        color: C.ink,
        fontFamily: "Arial, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 1200,
          height: 1200,
          top: -300,
          right: -500,
          background: "radial-gradient(circle, #c1a07a25, transparent 66%)",
          transform: `translateY(${Math.sin(f / 80) * 80}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 38,
          border: "1px solid #eee6d818",
          borderRadius: 38,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 120,
          left: 85,
          right: 85,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 34,
          fontWeight: 700,
        }}
      >
        <span>G&amp;D</span>
        <span style={{ fontSize: 23, fontWeight: 400, color: C.copper }}>
          gd1.online
        </span>
      </div>
      <Sequence durationInFrames={120}>
        <Hook />
      </Sequence>
      <Sequence from={120} durationInFrames={150}>
        <Library />
      </Sequence>
      <Sequence from={270} durationInFrames={180}>
        <Chat />
      </Sequence>
      <Sequence from={450} durationInFrames={150}>
        <Law />
      </Sequence>
      <Sequence from={600} durationInFrames={150}>
        <Practice />
      </Sequence>
      <Sequence from={750} durationInFrames={150}>
        <Finale />
      </Sequence>
      <div
        style={{
          position: "absolute",
          bottom: 150,
          left: 85,
          right: 85,
          display: "flex",
          gap: 14,
        }}
      >
        {[0, 120, 270, 450, 600, 750].map((start, i) => {
          const end = [120, 270, 450, 600, 750, 900][i];
          return (
            <div
              key={start}
              style={{
                flex: 1,
                height: 4,
                background: "#eee6d82a",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  background: C.copper,
                  width: `${interpolate(f, [start, end], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}%`,
                }}
              />
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
registerRoot(() => (
  <Composition
    id="GandDSocial"
    component={Social}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={900}
  />
));
