// PRD-406-R9 — page-level contract via top-level `act` const on a Remix route.
export const act = {
  id: 'about',
  type: 'page',
  title: 'About Acme Remix',
  summary: 'About-page contract supplied via the Remix route page-level const.',
};

export default function AboutRoute() {
  return null;
}
