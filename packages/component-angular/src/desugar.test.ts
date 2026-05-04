/**
 * PRD-303-R3 / R6 — static-field desugar helper.
 */
import { describe, expect, it } from 'vitest';
import { pickStaticContract } from './desugar.js';
import type { ActContract } from '@act-spec/component-contract';
import type { AngularComponentWithAct } from './types.js';

interface HeroProps { title: string }

class HeroComponent {
  static act: ActContract<HeroProps> = {
    type: 'marketing:hero',
    contract_version: '0.1',
    extract: (props) => ({ type: 'marketing:hero', headline: props.title }),
  };
}

class BareComponent {}

describe('PRD-303-R3 pickStaticContract', () => {
  it('PRD-303-R3: lifts the static `act` field off a component class', () => {
    const c = pickStaticContract(HeroComponent as unknown as AngularComponentWithAct<HeroProps>);
    expect(c?.type).toBe('marketing:hero');
    expect(c?.contract_version).toBe('0.1');
  });

  it('PRD-303-R3: returns undefined when the component has no `act` field', () => {
    expect(pickStaticContract(BareComponent as unknown as AngularComponentWithAct<unknown>))
      .toBeUndefined();
  });

  it('PRD-303-R3: returns undefined on null', () => {
    expect(pickStaticContract(null)).toBeUndefined();
  });

  it('PRD-303-R3: returns undefined on undefined', () => {
    expect(pickStaticContract(undefined)).toBeUndefined();
  });

  it('PRD-303-R6: static field result is byte-equal to the source contract object', () => {
    const c = pickStaticContract(HeroComponent as unknown as AngularComponentWithAct<HeroProps>);
    expect(c).toBe(HeroComponent.act);
  });
});
