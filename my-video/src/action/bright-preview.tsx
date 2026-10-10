import React from "react";
import {
  AbsoluteFill,
  Composition,
  Img,
  interpolate,
  registerRoot,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";

const purple = "#6524df",
  ink = "#24123d";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = (f: number, start: number, end: number) =>
  interpolate(f, [start, end], [0, 1], clamp);
const enter = (f: number, delay = 0) =>
  spring({
    frame: f - delay,
    fps: 30,
    config: { damping: 20, stiffness: 110 },
  });
const fade = (f: number, a: number, b: number) =>
  ease(f, a, a + 9) * (1 - ease(f, b - 9, b));
const Card: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => (
  <div
    style={{
      background: "#ffffffee",
      border: "2px solid #ffffff",
      borderRadius: 32,
      boxShadow: "0 20px 65px #6026ab19",
      ...style,
    }}
  >
    {children}
  </div>
);

const Symbol: React.FC<{ kind: number; size?: number }> = ({
  kind,
  size = 70,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 80 80"
    fill="none"
    stroke="currentColor"
    strokeWidth="4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {kind === 0 ? (
      <>
        <path d="M15 20Q28 12 40 22Q54 12 67 20V61Q53 54 40 64Q27 54 15 61Z" />
        <path d="M40 22V64M23 29L32 30M48 30L58 29M23 40L32 41M48 41L58 40" />
      </>
    ) : kind === 1 ? (
      <>
        <path d="M40 12V66M18 65H62M14 24H66M25 24L14 45H36ZM56 24L45 45H67Z" />
        <circle cx="40" cy="15" r="4" />
      </>
    ) : kind === 2 ? (
      <>
        <path d="M30 13H50V29H66V49H50V65H30V49H14V29H30Z" />
      </>
    ) : kind === 3 ? (
      <>
        <path d="M25 13H55V35Q55 54 40 54Q25 54 25 35ZM25 20H12V29Q12 41 25 42M55 20H68V29Q68 41 55 42M40 54V65M25 66H55" />
      </>
    ) : (
      <>
        <circle cx="33" cy="32" r="18" />
        <path d="M47 47L65 65M25 31L31 38L42 25" />
      </>
    )}
  </svg>
);

const Book: React.FC<{
  label: string;
  sub: string;
  color: string;
  style: React.CSSProperties;
}> = ({ label, sub, color, style }) => (
  <div
    style={{
      width: 260,
      height: 345,
      position: "absolute",
      borderRadius: "10px 24px 24px 10px",
      background: color,
      color: "white",
      boxShadow:
        "12px 18px 0 #eee8fa,18px 24px 0 #ded4ed,0 35px 65px #59369425",
      padding: "40px 28px 30px 38px",
      borderLeft: "15px solid #0002",
      ...style,
    }}
  >
    <Symbol kind={label === "LAW" ? 1 : 2} />
    <div
      style={{
        fontSize: 43,
        fontWeight: 800,
        marginTop: 35,
        letterSpacing: -1,
      }}
    >
      {label}
    </div>
    <div style={{ fontSize: 20, marginTop: 12, opacity: 0.85 }}>{sub}</div>
    <div
      style={{
        position: "absolute",
        bottom: 30,
        left: 38,
        right: 30,
        height: 2,
        background: "#fff6",
      }}
    />
  </div>
);

const Books = ({ f }: { f: number }) => {
  const exit = ease(f, 95, 133),
    grow = enter(f, 3);
  return (
    <AbsoluteFill style={{ opacity: 1 - ease(f, 126, 144) }}>
      <div
        style={{
          position: "absolute",
          top: 270,
          left: 80,
          right: 80,
          textAlign: "center",
          opacity: 1 - exit,
          transform: `translateY(${-70 * exit}px)`,
        }}
      >
        <div
          style={{
            fontSize: 30,
            letterSpacing: 5,
            color: purple,
            fontWeight: 700,
          }}
        >
          LAW & MEDICINE
        </div>
        <div
          style={{
            fontSize: 105,
            lineHeight: 1.02,
            letterSpacing: -6,
            fontWeight: 800,
            marginTop: 38,
          }}
        >
          Big books.
          <br />
          Bigger questions.
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 540,
          top: 930,
          transform: `scale(${grow})`,
        }}
      >
        <Book
          label="LAW"
          sub="Cases. Principles. Arguments."
          color="#6c35d4"
          style={{
            left: -345 + exit * 130,
            top: -100 - exit * 150,
            transform: `rotate(${-15 + exit * 20 + Math.sin(f / 45) * 2}deg) scale(${1 - exit * 0.25})`,
          }}
        />
        <Book
          label="MEDICINE"
          sub="Systems. Processes. Why?"
          color="#ed927f"
          style={{
            left: 40 - exit * 120,
            top: 30 - exit * 120,
            transform: `rotate(${12 - exit * 17 + Math.sin(f / 38) * 2}deg) scale(${1 - exit * 0.25})`,
          }}
        />
      </div>
      <Card
        style={{
          position: "absolute",
          left: 180,
          right: 180,
          top: 1430,
          padding: 30,
          textAlign: "center",
          fontSize: 35,
          color: purple,
          opacity: enter(f, 30) * (1 - exit),
          transform: `translateY(${(1 - enter(f, 30)) * 60}px)`,
        }}
      >
        What if your books could answer back?
      </Card>
    </AbsoluteFill>
  );
};

const Knowledge = ({ f }: { f: number }) => {
  const p = enter(f, 119),
    gather = ease(f, 170, 215),
    reveal = enter(f, 207),
    leave = ease(f, 312, 345);
  const question = "Why does heart rate rise during exercise?";
  return (
    <AbsoluteFill style={{ opacity: fade(f, 110, 349) }}>
      <div
        style={{
          position: "absolute",
          top: 265,
          left: 75,
          right: 75,
          textAlign: "center",
          transform: `translateY(${(1 - p) * 40}px)`,
          opacity: p,
        }}
      >
        <div
          style={{
            fontSize: 29,
            letterSpacing: 5,
            color: purple,
            fontWeight: 700,
          }}
        >
          01 / KNOWLEDGE FROM YOUR BOOKS
        </div>
        <div
          style={{
            fontSize: 85,
            fontWeight: 800,
            letterSpacing: -5,
            marginTop: 30,
          }}
        >
          Ask. Find. Understand.
        </div>
      </div>
      {Array.from({ length: 12 }, (_, i) => {
        const angle = (i * Math.PI) / 6 + f / 150;
        const radius = 410 * (1 - gather);
        return (
          <Card
            key={i}
            style={{
              position: "absolute",
              left: 540 + Math.cos(angle) * radius - 78,
              top: 945 + Math.sin(angle) * radius * 0.75 - 110,
              width: 156,
              height: 220,
              padding: 20,
              opacity: p * (1 - ease(f, 205, 228)),
              transform: `rotate(${(angle * 180) / Math.PI + 90}deg) scale(${1 - gather * 0.3})`,
            }}
          >
            <div style={{ fontSize: 13, color: purple, marginBottom: 15 }}>
              STUDY MATERIAL
            </div>
            {[0, 1, 2, 3, 4, 5].map((j) => (
              <div
                key={j}
                style={{
                  height: 6,
                  width: j % 2 ? "75%" : "100%",
                  background: i % 3 === 0 && j === 2 ? "#a174ec" : "#e8e1f0",
                  borderRadius: 8,
                  marginTop: 12,
                }}
              />
            ))}
          </Card>
        );
      })}
      <Card
        style={{
          position: "absolute",
          top: 550,
          left: 85,
          right: 85,
          padding: "35px 40px",
          color: ink,
          fontSize: 37,
          lineHeight: 1.25,
          opacity: p,
          transform: `translateY(${leave * -50}px)`,
        }}
      >
        <span style={{ color: purple, marginRight: 18 }}>Q.</span>
        {question.slice(0, Math.round(ease(f, 120, 163) * question.length))}
        <span style={{ color: purple, opacity: f % 24 < 12 ? 1 : 0 }}>|</span>
      </Card>
      <Card
        style={{
          position: "absolute",
          left: 100,
          right: 100,
          top: 795,
          padding: 46,
          opacity: reveal,
          transform: `translateY(${(1 - reveal) * 100}px) scale(${1 - leave * 0.2}) rotate(${leave * -5}deg)`,
          transformOrigin: "center center",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 22,
            alignItems: "center",
            fontSize: 29,
            color: purple,
            fontWeight: 700,
          }}
        >
          <Symbol kind={4} size={48} />
          FROM YOUR MATERIAL
        </div>
        <div
          style={{
            fontSize: 48,
            fontWeight: 700,
            lineHeight: 1.25,
            marginTop: 28,
          }}
        >
          Working muscles need more oxygen.
        </div>
        <div
          style={{
            fontSize: 31,
            lineHeight: 1.5,
            color: "#716080",
            marginTop: 25,
          }}
        >
          Heart rate rises to help deliver more oxygenated blood to the muscles.
        </div>
        <div
          style={{
            marginTop: 35,
            background: "#eee4ff",
            padding: "20px 25px",
            borderRadius: 18,
            color: purple,
            fontSize: 27,
          }}
        >
          Physiology textbook · page 142
        </div>
      </Card>
      <div
        style={{
          position: "absolute",
          top: 1345,
          left: 90,
          right: 90,
          textAlign: "center",
          opacity: enter(f, 245) * (1 - leave),
          fontSize: 44,
          fontWeight: 700,
          color: purple,
        }}
      >
        Clear answers.
        <br />
        <span style={{ color: ink }}>Sources you can check.</span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 1500,
          left: 90,
          right: 90,
          textAlign: "center",
          opacity: enter(f, 259) * (1 - leave),
          fontSize: 23,
          color: "#82748e",
        }}
      >
        Illustrative answer • actual G&D interface below
      </div>
      <Card
        style={{
          position: "absolute",
          left: 280,
          top: 1550,
          width: 520,
          height: 200,
          overflow: "hidden",
          opacity: enter(f, 264) * (1 - leave),
        }}
      >
        <Img
          src={staticFile("action/answer.png")}
          style={{ width: 520, position: "absolute", top: -175 }}
        />
      </Card>
    </AbsoluteFill>
  );
};

const Rivalry = ({ f }: { f: number }) => {
  const p = enter(f, 331),
    setup = ease(f, 375, 410),
    results = enter(f, 518),
    exit = ease(f, 594, 620);
  const score = Math.round(ease(f, 516, 546) * 5),
    other = Math.round(ease(f, 516, 546) * 4);
  return (
    <AbsoluteFill style={{ opacity: fade(f, 326, 625) }}>
      <div
        style={{
          position: "absolute",
          top: 250,
          left: 60,
          right: 60,
          textAlign: "center",
          opacity: p,
          transform: `scale(${0.75 + p * 0.25}) rotate(${(1 - p) * -7}deg)`,
        }}
      >
        <div
          style={{
            fontSize: 30,
            letterSpacing: 4,
            color: purple,
            fontWeight: 700,
          }}
        >
          02 / BRING YOUR FRIENDS
        </div>
        <div
          style={{
            fontSize: 108,
            fontWeight: 900,
            letterSpacing: -7,
            lineHeight: 1.02,
            marginTop: 30,
          }}
        >
          BATTLE
          <br />
          <span style={{ color: purple }}>ROYALE.</span>
        </div>
      </div>
      {[0, 1].map((i) => (
        <Card
          key={i}
          style={{
            position: "absolute",
            left: i ? 570 : 100,
            top: 660 + setup * -50,
            width: 410,
            padding: 35,
            textAlign: "center",
            opacity: p,
            transform: `translateX(${(1 - p) * (i ? 400 : -400)}px) rotate(${(1 - setup) * (i ? 7 : -7)}deg)`,
          }}
        >
          <div
            style={{
              margin: "0 auto",
              width: 125,
              height: 125,
              borderRadius: 80,
              background: i ? "#ffd7c5" : "#dac5ff",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              fontSize: 60,
              fontWeight: 800,
              color: i ? "#bc5e43" : purple,
            }}
          >
            {i ? "C" : "A"}
          </div>
          <div style={{ fontSize: 37, fontWeight: 700, marginTop: 24 }}>
            {i ? "Chidi" : "Ada"}
          </div>
          <div style={{ fontSize: 24, color: "#82748e", marginTop: 8 }}>
            {i ? "Your friend" : "You"}
          </div>
          <div
            style={{
              fontSize: 90,
              lineHeight: 1,
              fontWeight: 900,
              color: i ? "#dc876c" : purple,
              marginTop: 25,
              opacity: results,
            }}
          >
            {i ? other : score}
            <span style={{ fontSize: 32, color: "#9a8aaa" }}>/5</span>
          </div>
        </Card>
      ))}
      <div
        style={{
          position: "absolute",
          left: 480,
          top: 730,
          fontSize: 52,
          fontWeight: 900,
          color: purple,
          opacity: p * (1 - setup),
          transform: `scale(${p})`,
        }}
      >
        VS
      </div>
      <Card
        style={{
          position: "absolute",
          left: 100,
          right: 100,
          top: 1090 - setup * 90,
          padding: 40,
          opacity: setup * (1 - ease(f, 509, 532)),
          transform: `scale(${0.9 + setup * 0.1})`,
        }}
      >
        <div style={{ fontSize: 25, color: purple, letterSpacing: 2 }}>
          SAME QUESTIONS. YOUR OWN PACE.
        </div>
        <div
          style={{
            fontSize: 41,
            lineHeight: 1.2,
            fontWeight: 700,
            marginTop: 25,
          }}
        >
          What increases oxygen delivery during exercise?
        </div>
        {["A faster heart rate", "A slower heart rate"].map((s, i) => (
          <div
            key={s}
            style={{
              fontSize: 29,
              padding: 23,
              borderRadius: 17,
              marginTop: 18,
              border: `2px solid ${i === 0 && f > 465 ? purple : "#e7e0ed"}`,
              background: i === 0 && f > 465 ? "#eee4ff" : "white",
              color: i === 0 && f > 465 ? purple : ink,
            }}
          >
            {s}
            {i === 0 && f > 465 ? "  — selected" : ""}
          </div>
        ))}
      </Card>
      <div
        style={{
          position: "absolute",
          top: 1135,
          left: 80,
          right: 80,
          textAlign: "center",
          opacity: results * (1 - exit),
          transform: `translateY(${(1 - results) * 60}px)`,
        }}
      >
        <div style={{ color: purple }}>
          <Symbol kind={3} size={100} />
        </div>
        <div
          style={{
            fontSize: 74,
            letterSpacing: -3,
            fontWeight: 800,
            marginTop: 20,
          }}
        >
          Bragging rights:
          <br />
          earned.
        </div>
        <Card
          style={{
            display: "inline-block",
            padding: "20px 38px",
            marginTop: 35,
            fontSize: 38,
            color: purple,
            transform: `rotate(${Math.sin(f / 15) * 3}deg)`,
          }}
        >
          Rematch?
        </Card>
        <div style={{ fontSize: 25, color: "#82748e", marginTop: 28 }}>
          Compare scores after both players finish.
        </div>
      </div>
      <Card
        style={{
          position: "absolute",
          left: 305,
          top: 1550,
          width: 470,
          height: 160,
          overflow: "hidden",
          opacity: enter(f, 553) * (1 - exit),
        }}
      >
        <Img
          src={staticFile("action/battle-result.png")}
          style={{ position: "absolute", width: 470, top: -60 }}
        />
      </Card>
    </AbsoluteFill>
  );
};

const End = ({ f }: { f: number }) => {
  const p = enter(f, 609);
  return (
    <AbsoluteFill
      style={{
        opacity: ease(f, 602, 615),
        textAlign: "center",
        padding: "330px 75px",
      }}
    >
      <div
        style={{
          color: purple,
          transform: `scale(${p}) rotate(${(1 - p) * 90}deg)`,
        }}
      >
        <Symbol kind={0} size={150} />
      </div>
      <div
        style={{
          fontSize: 170,
          fontWeight: 900,
          letterSpacing: -10,
          marginTop: 30,
          transform: `translateY(${(1 - p) * 60}px)`,
        }}
      >
        G&amp;D
      </div>
      <div
        style={{
          fontSize: 65,
          lineHeight: 1.2,
          fontWeight: 800,
          letterSpacing: -3,
          marginTop: 40,
        }}
      >
        Understand the book.
        <br />
        <span style={{ color: purple }}>Win the bragging rights.</span>
      </div>
      <div style={{ fontSize: 32, color: "#82748e", marginTop: 45 }}>
        Built for law & medicine students.
      </div>
      <Card
        style={{
          margin: "75px 60px 0",
          padding: 35,
          fontSize: 65,
          fontWeight: 800,
          color: "white",
          background: purple,
          borderColor: purple,
          opacity: enter(f, 638),
          transform: `translateY(${(1 - enter(f, 638)) * 40}px)`,
        }}
      >
        gd1.online
      </Card>
      <div style={{ fontSize: 28, marginTop: 30, color: purple }}>
        Bring your books. Bring your friends.
      </div>
    </AbsoluteFill>
  );
};

const BrightPreview = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        background: "#fcfaff",
        color: ink,
        fontFamily: "Arial, sans-serif",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 1400,
          height: 1450,
          left: -180,
          top: 400,
          background:
            "radial-gradient(ellipse, #dfcaffbb 0%, #f8d9ea66 38%, transparent 68%)",
          transform: `translate(${Math.sin(f / 180) * 90}px,${Math.cos(f / 150) * 60}px)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1000,
          height: 1000,
          right: -480,
          top: 1100,
          background: "radial-gradient(circle, #ffcdb7aa,transparent 67%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 125,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 32,
          fontWeight: 800,
          color: purple,
        }}
      >
        <span>G&amp;D</span>
        <span style={{ fontSize: 24, fontWeight: 400 }}>
          Your next study advantage.
        </span>
      </div>
      <Books f={f} />
      <Knowledge f={f} />
      <Rivalry f={f} />
      <End f={f} />
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          bottom: 135,
          display: "flex",
          gap: 12,
        }}
      >
        {["YOUR BOOKS", "YOUR KNOWLEDGE", "YOUR RIVALRY"].map((s, i) => (
          <div
            key={s}
            style={{
              flex: 1,
              textAlign: "center",
              fontSize: 17,
              letterSpacing: 1,
              padding: 17,
              borderRadius: 15,
              background:
                (f < 120 ? 0 : f < 330 ? 1 : 2) === i ? purple : "#eee6f8",
              color:
                (f < 120 ? 0 : f < 330 ? 1 : 2) === i ? "white" : "#9584a7",
            }}
          >
            {s}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 75,
          left: 60,
          right: 60,
          fontSize: 18,
          textAlign: "center",
          color: "#8a7c97",
        }}
      >
        Creative preview · sample answers, players and scores
      </div>
    </AbsoluteFill>
  );
};
const Root = () => (
  <Composition
    id="GandDBrightPreview"
    component={BrightPreview}
    durationInFrames={720}
    fps={30}
    width={1080}
    height={1920}
  />
);
registerRoot(Root);
