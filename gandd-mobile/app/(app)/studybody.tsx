import { Redirect } from "expo-router";

// Legacy route. My Coach now lives at /coach (StudyBody + Practice merged into a
// single functional screen). Kept so old deep links don't 404.
export default function StudyBodyRedirect() {
  return <Redirect href="/coach" />;
}
