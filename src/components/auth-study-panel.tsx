import { ArrowUpRight, BookOpen, Check, FileText } from "lucide-react";

/** A quiet, illustrative introduction beside the authentication form. */
export function AuthStudyPanel() {
  return (
    <aside className="gd-entry-story" aria-label="Study with G&D">
      <span className="gd-entry-eyebrow">A space to understand more</span>
      <h2>
        Bring your notes.
        <br />
        <span>Find your focus.</span>
      </h2>
      <p className="gd-entry-story-copy">
        Your reading, questions, and practice. Together in one thoughtful study space.
      </p>

      <div className="gd-entry-illustration" aria-hidden="true">
        <div className="gd-entry-note">
          <div className="gd-entry-note-top">
            <span>
              <BookOpen size={17} /> Your study material
            </span>
            <ArrowUpRight size={17} />
          </div>
          <div className="gd-entry-note-lines">
            <span />
            <span />
            <span />
          </div>
          <div className="gd-entry-highlight">Start with the part you want to understand.</div>
          <div className="gd-entry-note-lines gd-entry-note-lines-short">
            <span />
            <span />
          </div>
          <div className="gd-entry-note-footer">
            <FileText size={14} /> Notes, textbooks, and questions
          </div>
        </div>
        <div className="gd-entry-question">
          <span className="gd-entry-question-mark">G&D</span>
          <p>“Break this down for me.”</p>
          <span className="gd-entry-question-label">A good place to start</span>
        </div>
      </div>

      <div className="gd-entry-story-footer">
        <span>
          <Check size={15} /> Learn at your own pace
        </span>
        <span>Built around your studies</span>
      </div>
    </aside>
  );
}
