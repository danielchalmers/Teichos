import { loadData } from './storage';
import { isFilterActive, matchesFilter } from './types';

async function shouldBlockUrl(url: string): Promise<boolean> {
  const data = await loadData();
  
  for (const filter of data.filters) {
    if (isFilterActive(filter, data.groups) && matchesFilter(url, filter.pattern)) {
      return true;
    }
  }
  
  return false;
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    const blocked = await shouldBlockUrl(tab.url);
    
    if (blocked) {
      const blockedUrl = chrome.runtime.getURL('blocked.html') + '?url=' + encodeURIComponent(tab.url);
      chrome.tabs.update(tabId, { url: blockedUrl });
    }
  }
});

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId === 0) { // Only check main frame
    const blocked = await shouldBlockUrl(details.url);
    
    if (blocked) {
      const blockedUrl = chrome.runtime.getURL('blocked.html') + '?url=' + encodeURIComponent(details.url);
      chrome.tabs.update(details.tabId, { url: blockedUrl });
    }
  }
});

console.log('PageBlock background service worker initialized');
