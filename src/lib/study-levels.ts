// The one list of study levels the app offers, shared by onboarding and
// settings so the two screens can never drift apart. They used to disagree -
// onboarding saved "100".."600" while settings offered "Year 1".."Other", so a
// student who onboarded then opened settings found nothing selected and could
// silently overwrite their level just by saving. One list, one vocabulary.
//
// The wording is deliberately field-neutral: G&D is open to every course, so a
// medical student, an engineer, and a postgraduate researcher all have to find
// themselves here.
export const STUDY_LEVELS = [
  "Year 1",
  "Year 2",
  "Year 3",
  "Year 4",
  "Year 5",
  "Year 6",
  "Postgraduate",
  "Other",
] as const;

export type StudyLevel = (typeof STUDY_LEVELS)[number];

/**
 * The options to render for a student whose saved level predates this list (or
 * came from somewhere else entirely). Rather than showing them an unselected
 * grid and quietly losing what they had, we surface their own value as a real
 * option alongside the standard ones.
 */
export function studyLevelOptions(current: string | null | undefined): string[] {
  const value = (current ?? "").trim();
  const options: string[] = [...STUDY_LEVELS];
  if (value && !options.includes(value)) options.push(value);
  return options;
}
