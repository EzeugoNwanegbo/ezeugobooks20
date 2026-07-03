import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy - G&D" },
      { name: "description", content: "Privacy policy for the G&D study app." },
    ],
  }),
  component: PrivacyPage,
});

const EFFECTIVE_DATE = "27 May 2026";
const CONTACT_EMAIL = "nwanegboezeugo@gmail.com";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2
        style={{
          fontSize: "1.05rem",
          fontWeight: 600,
          marginBottom: "0.6rem",
          lineHeight: 1.3,
        }}
      >
        {title}
      </h2>
      <div style={{ fontSize: "0.925rem", lineHeight: 1.7, opacity: 0.88 }}>{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <main className="luxury-page">
      <div className="symbiote-blob blob-one" />
      <div className="symbiote-blob blob-two" />

      <nav className="luxury-nav" aria-label="Primary navigation">
        <Link to="/" className="luxury-logo">
          G&D
        </Link>
      </nav>

      <section className="luxury-hero" style={{ paddingBottom: "1.5rem" }}>
        <p className="luxury-eyebrow">Legal</p>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3rem)" }}>Privacy Policy</h1>
        <p className="luxury-copy" style={{ maxWidth: "560px" }}>
          Effective date: {EFFECTIVE_DATE}
        </p>
      </section>

      <div
        style={{
          maxWidth: "680px",
          margin: "0 auto",
          padding: "0 1.5rem 5rem",
        }}
      >
        <Section title="1. Who we are">
          <p>
            G&D ("we", "our", "us") is a study tool that helps students search large documents and
            get precise, source-backed answers. The app is available on the web and as an Android
            app. For questions about this policy, email us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ textDecoration: "underline" }}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <Section title="2. Data we collect">
          <p style={{ marginBottom: "0.75rem" }}>
            We collect the following categories of personal data when you use G&D:
          </p>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.875rem",
              lineHeight: 1.6,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem 0.4rem 0", fontWeight: 600 }}>
                  Category
                </th>
                <th style={{ textAlign: "left", padding: "0.4rem 0.6rem", fontWeight: 600 }}>
                  Examples
                </th>
                <th style={{ textAlign: "left", padding: "0.4rem 0 0.4rem 0.6rem", fontWeight: 600 }}>
                  Purpose
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Account info", "Name, email address", "Authentication and personalisation"],
                [
                  "Profile info",
                  "University, year, course, exam format, preferred mode",
                  "Tailoring AI responses to your study context",
                ],
                [
                  "Documents",
                  "Text extracted from uploaded PDFs and notes",
                  "Powering document search and AI answers",
                ],
                ["Conversations", "Chat messages and AI responses", "Displaying your chat history"],
                [
                  "Study data",
                  "Study plans, topics, sessions, answers",
                  "StudyBody feature functionality",
                ],
                [
                  "Usage data",
                  "Pages visited, features used",
                  "Improving the app (via Supabase logs)",
                ],
              ].map(([cat, ex, purpose]) => (
                <tr
                  key={cat}
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <td style={{ padding: "0.45rem 0.6rem 0.45rem 0", verticalAlign: "top", fontWeight: 500 }}>
                    {cat}
                  </td>
                  <td style={{ padding: "0.45rem 0.6rem", verticalAlign: "top" }}>{ex}</td>
                  <td style={{ padding: "0.45rem 0 0.45rem 0.6rem", verticalAlign: "top" }}>
                    {purpose}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: "0.75rem" }}>
            Raw PDF files are processed entirely in your browser using Tesseract.js. Only the
            extracted text is sent to our servers - the original file is never uploaded.
          </p>
        </Section>

        <Section title="3. How we use your data">
          <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <li>To provide and operate the G&D service</li>
            <li>To personalise AI responses using your study profile (name, university, course, preferences)</li>
            <li>To retrieve relevant passages from your uploaded documents</li>
            <li>To store and display your conversation and study history</li>
            <li>To authenticate you and secure your account</li>
          </ul>
          <p style={{ marginTop: "0.75rem" }}>
            We do not use your data for advertising, sell it to third parties, or use it to train
            AI models.
          </p>
        </Section>

        <Section title="4. Third parties we share data with">
          <p style={{ marginBottom: "0.75rem" }}>
            To operate the service we share certain data with the following third parties:
          </p>
          <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <li>
              <strong>Supabase</strong> - our backend provider. Stores your account, profile,
              documents, conversations, and study data. Data is encrypted at rest and in transit.
              See{" "}
              <a
                href="https://supabase.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "underline" }}
              >
                supabase.com/privacy
              </a>
              .
            </li>
            <li>
              <strong>DeepSeek</strong> - AI provider used for document retrieval and drafting
              answers. Your study profile and relevant document excerpts are sent with each
              request. See{" "}
              <a
                href="https://www.deepseek.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "underline" }}
              >
                deepseek.com/privacy
              </a>
              .
            </li>
            <li>
              <strong>OpenAI</strong> - AI provider used for final answer styling and web search.
              Your study profile and DeepSeek's draft are sent with each request. See{" "}
              <a
                href="https://openai.com/policies/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "underline" }}
              >
                openai.com/policies/privacy-policy
              </a>
              .
            </li>
            <li>
              <strong>Google</strong> - if you sign in with Google, Google shares your name and
              email address with us via OAuth. See{" "}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "underline" }}
              >
                policies.google.com/privacy
              </a>
              .
            </li>
          </ul>
        </Section>

        <Section title="5. Data security">
          <p>
            All data is transmitted over HTTPS. Your data is stored in Supabase, which encrypts
            data at rest. Access to your data is restricted by row-level security policies -
            you can only read and write your own records. Authentication uses industry-standard
            JWT tokens.
          </p>
        </Section>

        <Section title="6. Data retention">
          <p>
            We retain your data for as long as your account is active. If you delete your account,
            all associated data - profile, documents, conversations, study plans, and
            authentication credentials - is permanently and immediately deleted with no retention
            period. See our{" "}
            <Link to="/delete-account" style={{ textDecoration: "underline" }}>
              account deletion page
            </Link>{" "}
            for instructions.
          </p>
        </Section>

        <Section title="7. Your rights">
          <p style={{ marginBottom: "0.6rem" }}>You have the right to:</p>
          <ul style={{ paddingLeft: "1.25rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <li>
              <strong>Delete your account and all data</strong> - from within the app (menu →
              Delete account) or by emailing us
            </li>
            <li>
              <strong>Delete specific data</strong> - delete individual documents, conversations,
              or messages from within the app at any time
            </li>
            <li>
              <strong>Access your data</strong> - email us and we will provide a copy of the
              personal data we hold about you
            </li>
            <li>
              <strong>Correct your data</strong> - update your profile from within the app
            </li>
          </ul>
          <p style={{ marginTop: "0.75rem" }}>
            To exercise any of these rights, email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ textDecoration: "underline" }}>
              {CONTACT_EMAIL}
            </a>
            . We will respond within 7 days.
          </p>
        </Section>

        <Section title="8. Children's privacy">
          <p>
            G&D is not directed at children under 13. We do not knowingly collect personal data
            from children under 13. If you believe a child under 13 has provided us with personal
            data, please contact us and we will delete it promptly.
          </p>
        </Section>

        <Section title="9. Changes to this policy">
          <p>
            We may update this policy from time to time. We will post the new policy on this page
            with an updated effective date. Continued use of G&D after changes constitutes
            acceptance of the revised policy.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            Questions, requests, or concerns about this policy:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ textDecoration: "underline" }}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </Section>
      </div>
    </main>
  );
}
