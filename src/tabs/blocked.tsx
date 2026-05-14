import { createElement, useEffect, useRef, type ReactElement } from 'react';
import blockedTemplateHtml from 'data-text:../blocked-page/index.html';
import '../blocked-page/styles/blocked.css';
import { init } from '../blocked-page/index';
import { mountStaticPage, parseStaticPageTemplate } from '../shared/utils/staticPage';

const blockedTemplate = parseStaticPageTemplate(blockedTemplateHtml);

export default function BlockedPage(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    mountStaticPage(host, blockedTemplate);
    init();

    return (): void => {
      host.replaceChildren();
    };
  }, []);

  return createElement('div', {
    ref: hostRef,
    style: { display: 'contents' },
  });
}
