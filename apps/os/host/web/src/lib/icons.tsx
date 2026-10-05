// Small icons several modules share.

/** Git branch mark. The ⎇ character isn't in our fonts, so browsers substitute a glyph that looks broken. */
export function BranchIcon() {
  return (
    <svg className="branch-ic" width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <circle cx="4.5" cy="3.5" r="1.6" />
      <circle cx="4.5" cy="12.5" r="1.6" />
      <circle cx="11.5" cy="5" r="1.6" />
      <path d="M4.5 5.1v5.8M11.5 6.6c0 3-7 2.4-7 4.3" />
    </svg>
  );
}
