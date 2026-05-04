// PRD-405-R8 — App Router page-level contract via top-level `act` const.
export const act = {
  id: 'about',
  type: 'page',
  title: 'About Acme',
  summary: 'About-page contract supplied via the App Router page-level const.',
};

export default function AboutPage() {
  return null;
}
