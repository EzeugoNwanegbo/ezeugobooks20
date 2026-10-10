import React from "react";
import {
  AbsoluteFill,
  Composition,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  registerRoot,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

const bone = "#eee6d8",
  copper = "#c1a07a",
  muted = "#aaa496";
const pop = (f: number, delay = 0) =>
  spring({
    frame: f - delay,
    fps: 30,
    config: { damping: 22, stiffness: 100 },
  });
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const Screenshot: React.FC<{ src: string; focus?: string; zoom?: number }> = ({
  src,
  focus = "center top",
  zoom = 1,
}) => (
  <Img
    src={staticFile(`action/${src}.png`)}
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: focus,
      transform: `scale(${zoom})`,
      transformOrigin: focus,
    }}
  />
);
const Footage: React.FC<{ src: string; focus?: string }> = ({
  src,
  focus = "center top",
}) => (
  <OffthreadVideo
    src={staticFile(`action/${src}.mp4`)}
    muted
    style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: focus,
    }}
  />
);
const BrowserFrame: React.FC<{
  children: React.ReactNode;
  label: string;
  tilt?: boolean;
}> = ({ children, label, tilt = false }) => {
  const f = useCurrentFrame(),
    p = pop(f, 8);
  return (
    <div
      style={{
        position: "absolute",
        left: 65,
        right: 65,
        top: 495,
        height: 1040,
        border: "2px solid #c1a07a55",
        borderRadius: 36,
        background: "#111110",
        boxShadow: "0 28px 90px #0008",
        overflow: "hidden",
        opacity: p,
        transform: `translateY(${(1 - p) * 60}px) rotate(${tilt ? Math.sin(f / 95) * 0.6 : 0}deg)`,
      }}
    >
      <div
        style={{
          height: 65,
          background: "#20201b",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 28px",
          borderBottom: "1px solid #eee6d82a",
        }}
      >
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: 20,
            background: copper,
          }}
        />
        <span style={{ fontSize: 21, color: muted }}>
          gd1.online <span style={{ color: bone }}> / {label}</span>
        </span>
      </div>
      <div style={{ position: "relative", height: 975, overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
};
const Stage: React.FC<{
  label: string;
  title: React.ReactNode;
  children: React.ReactNode;
  duration: number;
}> = ({ label, title, children, duration }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(
          f,
          [0, 10, duration - 8, duration - 1],
          [0, 1, 1, 0],
          clamp,
        ),
      }}
    >
      <div style={{ position: "absolute", left: 85, right: 85, top: 235 }}>
        <div
          style={{
            fontSize: 25,
            letterSpacing: 3,
            color: copper,
            marginBottom: 28,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.07,
            letterSpacing: -3,
            transform: `translateY(${(1 - pop(f)) * 40}px)`,
          }}
        >
          {title}
        </div>
      </div>
      {children}
    </AbsoluteFill>
  );
};
const Hook = () => {
  const f = useCurrentFrame();
  const page = Math.round(interpolate(f, [0, 45], [1, 300], clamp));
  return (
    <AbsoluteFill
      style={{
        padding: "260px 85px",
        opacity: interpolate(f, [0, 10, 112, 119], [0, 1, 1, 0], clamp),
      }}
    >
      <div style={{ fontSize: 25, letterSpacing: 3, color: copper }}>
        FOR LAW & MEDICINE STUDENTS
      </div>
      <div
        style={{
          fontSize: 93,
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: -4,
          marginTop: 55,
        }}
      >
        300 pages.
        <br />
        One question.
        <br />
        <span style={{ color: copper }}>
          Brain still
          <br />
          buffering?
        </span>
      </div>
      <div style={{ position: "relative", marginTop: 95, height: 385 }}>
        {[2, 1, 0].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              inset: 0,
              background: i === 0 ? "#e6dccb" : "#b5a28b",
              borderRadius: 24,
              transform: `translate(${i * 14}px,${i * 14}px) rotate(${i === 0 ? -3 + Math.sin(f / 28) : i * 4}deg)`,
              boxShadow: "0 20px 45px #0005",
              padding: 45,
              color: "#201b14",
            }}
          >
            {i === 0 && (
              <>
                <div style={{ fontSize: 24, letterSpacing: 3 }}>
                  YOUR STUDY MATERIAL
                </div>
                <div style={{ fontSize: 82, fontWeight: 700, marginTop: 30 }}>
                  Page {page}
                </div>
                <div style={{ marginTop: 25, fontSize: 34 }}>
                  Let’s find the part that matters.
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
const Search = () => {
  const f = useCurrentFrame();
  return (
    <Stage
      label="01 / FROM PAGES TO PASSAGES"
      title={
        <>
          Your question.
          <br />
          <span style={{ color: copper }}>Your chosen files.</span>
        </>
      }
      duration={240}
    >
      <BrowserFrame label="pinpoint search" tilt>
        {f < 150 ? (
          <Footage
            src="search"
            focus={f < 90 ? "center center" : "center bottom"}
          />
        ) : (
          <Screenshot src="answer" focus="center 30%" />
        )}
      </BrowserFrame>
      <div
        style={{
          position: "absolute",
          top: 1565,
          left: 85,
          right: 85,
          fontSize: 27,
          color: copper,
          display: "flex",
          gap: 18,
          alignItems: "center",
        }}
      >
        <span
          style={{ width: 9, height: 9, background: copper, borderRadius: 20 }}
        />
        Choose your file. Type what you need.
      </div>
    </Stage>
  );
};
const Answer = () => {
  const f = useCurrentFrame();
  return (
    <Stage
      label="02 / THE “OH, I GET IT” MOMENT"
      title={
        <>
          Make it clearer.
          <br />
          <span style={{ color: copper }}>See the source.</span>
        </>
      }
      duration={180}
    >
      <BrowserFrame label="answer from your files">
        <Screenshot
          src="answer"
          focus="center 30%"
          zoom={interpolate(f, [0, 150], [1, 1.035], clamp)}
        />
      </BrowserFrame>
      <div
        style={{
          position: "absolute",
          top: 1570,
          left: 85,
          right: 85,
          fontSize: 28,
          color: copper,
        }}
      >
        Physiology study textbook · page 142
      </div>
    </Stage>
  );
};
const Setup = () => {
  const f = useCurrentFrame();
  return (
    <Stage
      label="03 / A LITTLE FRIENDLY COMPETITION"
      title={
        <>
          Bring a friend.
          <br />
          <span style={{ color: copper }}>Send a challenge.</span>
        </>
      }
      duration={240}
    >
      <BrowserFrame label="Battle Royale" tilt>
        {f < 105 ? (
          <Footage src="setup" focus="center top" />
        ) : (
          <Screenshot src="battle-setup" focus="center bottom" />
        )}
      </BrowserFrame>
      <div
        style={{
          position: "absolute",
          top: 1570,
          left: 85,
          right: 85,
          fontSize: 28,
          color: copper,
        }}
      >
        Pick the material. Set the questions. Battle.
      </div>
    </Stage>
  );
};
const Quiz = () => {
  const f = useCurrentFrame();
  return (
    <Stage
      label="04 / UNDERSTAND IT. PROVE IT."
      title={
        <>
          Same questions.
          <br />
          <span style={{ color: copper }}>Who’s got this?</span>
        </>
      }
      duration={210}
    >
      <BrowserFrame label={f < 135 ? "timed quiz" : "battle result"}>
        {f < 135 ? (
          <Footage src="quiz" focus="center top" />
        ) : (
          <Screenshot src="battle-result" focus="center top" zoom={1.04} />
        )}
      </BrowserFrame>
      <div
        style={{
          position: "absolute",
          top: 1570,
          left: 85,
          right: 85,
          fontSize: 28,
          color: copper,
        }}
      >
        {f < 135
          ? "Play at your own pace."
          : "Compare scores once both players finish."}
      </div>
    </Stage>
  );
};
const Arrow = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
    <path
      d="M8 24h32M28 12l12 12-12 12"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const Finale = () => {
  const f = useCurrentFrame(),
    p = pop(f, 8);
  return (
    <AbsoluteFill
      style={{
        padding: "300px 85px",
        textAlign: "center",
        opacity: interpolate(f, [0, 12], [0, 1], clamp),
      }}
    >
      <div style={{ fontSize: 25, letterSpacing: 4, color: copper }}>
        FOR LAW & MEDICINE
      </div>
      <div
        style={{
          fontSize: 185,
          fontWeight: 700,
          letterSpacing: -10,
          marginTop: 80,
          transform: `scale(${0.9 + p * 0.1})`,
        }}
      >
        G&amp;D
      </div>
      <div
        style={{
          fontSize: 87,
          fontWeight: 700,
          lineHeight: 1.12,
          letterSpacing: -4,
          marginTop: 65,
        }}
      >
        {["Find it.", "Understand it.", "Prove it."].map((word, i) => (
          <div
            key={word}
            style={{
              opacity: pop(f, 14 + i * 12),
              transform: `translateY(${(1 - pop(f, 14 + i * 12)) * 30}px)`,
              color: i === 1 ? copper : bone,
            }}
          >
            {word}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 32, color: muted, marginTop: 55 }}>
        Less searching. More clarity.
      </div>
      <div
        style={{
          background: copper,
          color: "#171410",
          padding: "35px 45px",
          borderRadius: 25,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 35,
          marginTop: 95,
          fontSize: 65,
          fontWeight: 700,
          opacity: pop(f, 35),
        }}
      >
        gd1.online <Arrow />
      </div>
      <div style={{ fontSize: 31, marginTop: 35 }}>Start your workspace.</div>
    </AbsoluteFill>
  );
};
const captions = [
  [0, 4, "300 pages. One question. Brain still buffering?"],
  [4, 8, "Choose your textbook. Ask your question."],
  [8, 12, "Let pinpoint search find the relevant parts."],
  [12, 15, "Get an explanation grounded in your files."],
  [15, 18, "See where it came from."],
  [18, 22, "Ready to test yourself? Pick a friend."],
  [22, 26, "Set up Battle Royale and send the challenge."],
  [26, 29.5, "Same questions. Play at your own pace."],
  [29.5, 33, "Then compare your scores."],
  [33, 36.5, "For law and medicine. Find it. Understand it. Prove it."],
  [36.5, 40, "Start your workspace at gd1.online."],
] as const;
const ActionPromo = () => {
  const f = useCurrentFrame();
  const cap = captions.find(
    ([start, end]) => f >= start * 30 && f < end * 30,
  )?.[2];
  return (
    <AbsoluteFill
      style={{
        background: "#0b0b0a",
        color: bone,
        fontFamily: "Arial, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          height: 1600,
          width: 1300,
          top: -400,
          right: -500,
          background: "radial-gradient(circle, #c1a07a22, transparent 67%)",
          transform: `translateY(${Math.sin(f / 100) * 65}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 38,
          border: "1px solid #eee6d815",
          borderRadius: 38,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 125,
          left: 85,
          right: 85,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 32,
          fontWeight: 700,
        }}
      >
        <span>G&amp;D</span>
        <span style={{ fontSize: 23, color: copper, fontWeight: 400 }}>
          gd1.online
        </span>
      </div>
      <Sequence durationInFrames={120}>
        <Hook />
      </Sequence>
      <Sequence from={120} durationInFrames={240}>
        <Search />
      </Sequence>
      <Sequence from={360} durationInFrames={180}>
        <Answer />
      </Sequence>
      <Sequence from={540} durationInFrames={240}>
        <Setup />
      </Sequence>
      <Sequence from={780} durationInFrames={210}>
        <Quiz />
      </Sequence>
      <Sequence from={990} durationInFrames={210}>
        <Finale />
      </Sequence>
      <div
        style={{
          position: "absolute",
          left: 65,
          right: 65,
          top: 1660,
          minHeight: 92,
          padding: "18px 25px",
          borderRadius: 15,
          background: "#0b0b0ae8",
          textAlign: "center",
          fontSize: 34,
          lineHeight: 1.3,
          fontWeight: 500,
        }}
      >
        {cap}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 95,
          left: 65,
          right: 65,
          textAlign: "center",
          fontSize: 18,
          color: muted,
        }}
      >
        Demonstration · sample files and players · edited for clarity
      </div>
    </AbsoluteFill>
  );
};
registerRoot(() => (
  <Composition
    id="GandDInAction"
    component={ActionPromo}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={1200}
  />
));
