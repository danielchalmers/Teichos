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
export function getElementByIdOrNull<T extends HTMLElement>(id: string): T | null {
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

/**
 * Announce a message through the page's visually hidden `#status-message` live region.
 * The text is cleared first so repeating the same message is announced again.
 */
export function announceStatus(message: string): void {
  const status = getElementByIdOrNull('status-message');
  if (!status) return;
  status.textContent = '';
  window.setTimeout(() => {
    status.textContent = message;
  }, 0);
}

/**
 * Show an input or save error inside the open dialog, tie it to the field it is about, and
 * announce it, so the error is visible, persistent, and available to assistive technology.
 */
export function showDialogError(
  errorId: string,
  message: string,
  field?: HTMLElement | null
): void {
  clearDialogError(errorId);
  const error = getElementByIdOrNull(errorId);
  if (error) {
    error.textContent = message;
    error.hidden = false;
    // At high zoom the dialog scrolls, so bring the message into view.
    error.scrollIntoView({ block: 'nearest' });
  }
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', errorId);
  }
  announceStatus(message);
}

export function clearDialogError(errorId: string): void {
  const error = getElementByIdOrNull(errorId);
  if (error) {
    // Drop the announced copy too, so a screen reader reading the page later doesn't find a stale
    // error; leave the region alone if something else has been announced since.
    const status = getElementByIdOrNull('status-message');
    if (status && error.textContent && status.textContent === error.textContent) {
      status.textContent = '';
    }
    error.textContent = '';
    error.hidden = true;
  }
  document.querySelectorAll(`[aria-describedby="${CSS.escape(errorId)}"]`).forEach((field) => {
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-describedby');
  });
}
