/**
 * PRD-302-R5 — `<ActSection>` page-level boundary wrapper component.
 *
 * Receives a `contract` prop conforming to `PageContract` and renders
 * its slot inside the surrounding `installActProvider` scope. Sets the
 * page contract on the surrounding collector when none is set yet
 * (mirrors PRD-301's `ActContractWrapper` semantics on the React side).
 *
 * For non-page contexts (e.g., a layout section declaring its own page
 * scope) and for Options-API authors who prefer a wrapper to a macro.
 */
import { defineComponent, inject, type PropType } from 'vue';
import type { PageContract } from '@act-spec/component-contract';
import { COLLECTOR_KEY } from './provider.js';

export const ActSection = defineComponent({
  name: 'ActSection',
  props: {
    contract: {
      type: Object as PropType<PageContract>,
      required: true,
    },
  },
  setup(props, { slots }) {
    const state = inject(COLLECTOR_KEY, null);
    if (state !== null && state.pageContract === undefined) {
      state.pageContract = props.contract;
    }
    return (): unknown => (slots['default'] !== undefined ? slots['default']() : null);
  },
});
