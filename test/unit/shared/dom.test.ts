import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addListener,
  cloneTemplate,
  createElement,
  getElementById,
  getElementByIdOrNull,
  querySelector,
  querySelectorAll,
} from '../../../src/shared/utils/dom';

class FakeElement extends EventTarget {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: unknown[] = [];

  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  appendChild(child: unknown): unknown {
    this.children.push(child);
    return child;
  }

  cloneNode(): FakeElement {
    const clone = new FakeElement(this.tagName.toLowerCase());
    this.attributes.forEach((value, key) => clone.setAttribute(key, value));
    this.children.forEach((child) => clone.appendChild(child));
    return clone;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shared/utils/dom', () => {
  it('gets elements by id and throws when missing', () => {
    const element = new FakeElement('div') as unknown as HTMLDivElement;
    vi.stubGlobal('document', {
      getElementById: vi.fn((id: string) => (id === 'present' ? element : null)),
    });

    expect(getElementById<HTMLDivElement>('present')).toBe(element);
    expect(getElementByIdOrNull<HTMLDivElement>('missing')).toBeNull();
    expect(() => getElementById<HTMLDivElement>('missing')).toThrow(
      'Element with id "missing" not found'
    );
  });

  it('clones templates and queries selectors', () => {
    const root = new FakeElement('section');
    const queried = new FakeElement('span') as unknown as HTMLSpanElement;
    const queriedList = [queried] as unknown as NodeListOf<HTMLSpanElement>;
    vi.stubGlobal('document', {
      getElementById: vi.fn(() => ({ content: { firstElementChild: root } })),
      querySelector: vi.fn((selector: string) => (selector === '.found' ? queried : null)),
      querySelectorAll: vi.fn(() => queriedList),
    });

    expect(cloneTemplate<HTMLElement>('template')).not.toBe(root);
    expect(querySelector<HTMLSpanElement>('.found')).toBe(queried);
    expect(querySelectorAll<HTMLSpanElement>('.item')).toBe(queriedList);
    expect(() => querySelector<HTMLSpanElement>('.missing')).toThrow(
      'Element matching ".missing" not found'
    );
  });

  it('creates elements and listener cleanup callbacks', () => {
    const created = new FakeElement('button');
    const textNode = { nodeType: 'text', textContent: 'child text' };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => created),
      createTextNode: vi.fn((text: string) => ({ ...textNode, textContent: text })),
    });

    const nested = new FakeElement('span');
    const button = createElement('button', { 'data-role': 'save' }, [
      'child text',
      nested as unknown as Node,
    ]);
    expect(button).toBe(created);
    expect(created.attributes.get('data-role')).toBe('save');
    expect(created.children).toHaveLength(2);

    const listener = vi.fn();
    const dispose = addListener(created as unknown as HTMLElement, 'click', listener as never);
    created.dispatchEvent(new Event('click'));
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    created.dispatchEvent(new Event('click'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
