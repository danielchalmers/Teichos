import { createElement, useEffect, useRef, type ReactElement } from 'react';
import optionsTemplateHtml from 'data-text:./options-page/index.html';
import optionsIcon from 'url:./assets/icons/icon32.png';
import './options-page/styles/options.css';
import { init } from './options-page/index';
import { mountStaticPage, parseStaticPageTemplate } from './shared/utils/staticPage';

const optionsTemplate = parseStaticPageTemplate(optionsTemplateHtml);

export default function OptionsPage(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    mountStaticPage(host, optionsTemplate, {
      '.app-icon': optionsIcon,
    });

    void init().catch((error: unknown) => {
      console.error('Failed to initialize options page:', error);
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
