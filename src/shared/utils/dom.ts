/**
 * DOM utility functions for UI components
 */

/**
 * Get an element by ID with type safety
 * @throws Error if element not found
 */
export function getElementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id) as T | null;
  if (!element) {
    throw new Error(`Element with id "${id}" not found`);
  }
  return element;
}

/**
 * Get an element by ID, returning null if not found
 */
export function getElementByIdOrNull<T extends HTMLElement>(
  id: string
): T | null {
  return document.getElementById(id) as T | null;
}

export function cloneTemplate<T extends HTMLElement>(id: string): T {
  const template = getElementById<HTMLTemplateElement>(id);
  const element = template.content.firstElementChild;
  if (!element) {
    throw new Error(`Template "${id}" has no root element`);
  }
  return element.cloneNode(true) as T;
}

/**
 * Query selector with type safety
 * @throws Error if element not found
 */
export function querySelector<T extends HTMLElement>(
  selector: string,
  parent: ParentNode = document
): T {
  const element = parent.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Element matching "${selector}" not found`);
  }
  return element;
}

/**
 * Query all matching elements
 */
export function querySelectorAll<T extends HTMLElement>(
  selector: string,
  parent: ParentNode = document
): NodeListOf<T> {
  return parent.querySelectorAll<T>(selector);
}

/**
 * Add event listener with automatic cleanup tracking
 */
export function addListener<K extends keyof HTMLElementEventMap>(
  element: HTMLElement,
  type: K,
  listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
): () => void {
  element.addEventListener(type, listener, options);
  return () => element.removeEventListener(type, listener, options);
}

/**
 * Create an element with attributes and children
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes?: Record<string, string>,
  children?: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      element.setAttribute(key, value);
    }
  }

  if (children) {
    for (const child of children) {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else {
        element.appendChild(child);
      }
    }
  }

  return element;
}
