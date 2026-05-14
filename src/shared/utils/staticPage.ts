export interface StaticPageTemplate {
  bodyHtml: string;
  lang: string | null;
  title: string;
}

export function parseStaticPageTemplate(documentHtml: string): StaticPageTemplate {
  const parsed = new DOMParser().parseFromString(documentHtml, 'text/html');
  parsed.querySelectorAll('link[rel="stylesheet"], script').forEach((element) => {
    element.remove();
  });

  return {
    bodyHtml: parsed.body.innerHTML,
    lang: parsed.documentElement.lang || null,
    title: parsed.title,
  };
}

export function mountStaticPage(
  host: HTMLElement,
  template: StaticPageTemplate,
  imageSources: Record<string, string> = {}
): void {
  if (template.lang) {
    document.documentElement.lang = template.lang;
  }

  document.title = template.title;
  host.innerHTML = template.bodyHtml;

  Object.entries(imageSources).forEach(([selector, source]) => {
    const image = host.querySelector<HTMLImageElement>(selector);
    if (image) {
      image.src = source;
    }
  });
}
