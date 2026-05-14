import { createElement, useEffect, useRef, type ReactElement } from 'react';
import popupTemplateHtml from 'data-text:./popup-page/index.html';
import popupIcon from 'url:./assets/icons/icon16.png';
import './popup-page/styles/popup.css';
import { init } from './popup-page/index';
import { mountStaticPage, parseStaticPageTemplate } from './shared/utils/staticPage';

const popupTemplate = parseStaticPageTemplate(popupTemplateHtml);

export default function PopupPage(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    mountStaticPage(host, popupTemplate, {
      '.app-icon': popupIcon,
    });

    void init().catch((error: unknown) => {
      console.error('Failed to initialize popup page:', error);
    });

    return (): void => {
      host.replaceChildren();
    };
  }, []);

  return createElement('div', {
    ref: hostRef,
    style: { display: 'contents' },
  });
}
