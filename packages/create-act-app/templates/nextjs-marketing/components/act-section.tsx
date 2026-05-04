// Minimal runtime wrapper used by the App Router pages.
//
// At extraction time (during the ACT build), the binding's SSR walker
// recognizes <ActSection of={C} {...props} /> and registers the contract
// on `C`. At runtime in Next's App Router, all we need is to render `C`.
//
// We write a local copy here (rather than importing ActSection from
// `@act-spec/component-react`) because the package's index also exports
// the SSR walker, and Next.js disallows `react-dom/server` imports from
// server components.
import type { ComponentType, ReactElement } from 'react';

export function ActSection<P extends object>({
  of: Component,
  ...props
}: { of: ComponentType<P> } & P): ReactElement {
  return <Component {...(props as P)} />;
}
