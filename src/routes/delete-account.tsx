import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/delete-account")({
  head: () => ({
    meta: [
      { title: "Delete Account - G&D" },
      { name: "description", content: "How to delete your G&D account and all associated data." },
    ],
  }),
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  return (
    <main className="luxury-page">
      <div className="symbiote-blob blob-one" />
      <div className="symbiote-blob blob-two" />

      <nav className="luxury-nav" aria-label="Primary navigation">
        <Link to="/" className="luxury-logo">
          G&D
        </Link>
      </nav>

      <section className="luxury-hero" style={{ paddingBottom: "2rem" }}>
        <p className="luxury-eyebrow">Account management</p>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)" }}>Delete your G&D account</h1>
        <p className="luxury-copy">
          You can permanently delete your G&D account and all associated data directly inside the
          app. There is no waiting period - deletion happens immediately.
        </p>
      </section>

      <section
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          padding: "0 1.5rem 4rem",
          display: "flex",
          flexDirection: "column",
          gap: "2rem",
        }}
      >
        <div className="luxury-card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem", fontWeight: 600 }}>
            Steps to delete your account in-app
          </h2>
          <ol
            style={{
              paddingLeft: "1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.6rem",
              fontSize: "0.925rem",
              lineHeight: "1.6",
            }}
          >
            <li>Open the G&D app and sign in to your account.</li>
            <li>Tap the menu icon (top-left on mobile, or the sidebar on desktop).</li>
            <li>
              Scroll to the bottom of the menu and tap{" "}
              <strong>Delete account</strong>.
            </li>
            <li>
              Read the confirmation prompt, then tap <strong>Delete account</strong> to confirm.
            </li>
          </ol>
        </div>

        <div className="luxury-card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem", fontWeight: 600 }}>
            What data is deleted
          </h2>
          <ul
            style={{
              paddingLeft: "1.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              fontSize: "0.925rem",
              lineHeight: "1.6",
            }}
          >
            <li>Your profile (name, university, year, course, preferences)</li>
            <li>All uploaded documents and their extracted text</li>
            <li>All conversations and chat messages</li>
            <li>All study plans, topics, sessions, and answers</li>
            <li>Your authentication credentials</li>
          </ul>
          <p
            style={{
              marginTop: "1rem",
              fontSize: "0.875rem",
              opacity: 0.7,
              lineHeight: "1.5",
            }}
          >
            Deletion is permanent and immediate. No data is retained after your account is deleted.
          </p>
        </div>

        <div className="luxury-card" style={{ padding: "1.5rem" }}>
          <h2 style={{ marginBottom: "0.75rem", fontSize: "1.1rem", fontWeight: 600 }}>
            Need help?
          </h2>
          <p style={{ fontSize: "0.925rem", lineHeight: "1.6" }}>
            If you are unable to access the app to delete your account, email us at{" "}
            <a
              href="mailto:nwanegboezeugo@gmail.com"
              style={{ textDecoration: "underline", opacity: 0.85 }}
            >
              nwanegboezeugo@gmail.com
            </a>{" "}
            with the subject line <em>Account deletion request</em> and we will delete your account
            and all associated data within 7 days.
          </p>
        </div>
      </section>
    </main>
  );
}
