import { loadData } from './storage';
import { isFilterActive, matchesFilter } from './types';

async function shouldBlockUrl(url: string): Promise<boolean> {
  const data = await loadData();
  
  // Check whitelist first - if URL matches any enabled whitelist pattern, don't block
  for (const whitelist of data.whitelist) {
    if (whitelist.enabled && matchesFilter(url, whitelist.pattern, whitelist.isRegex ?? false)) {
      return false;
    }
  }
  
  for (const filter of data.filters) {
    if (isFilterActive(filter, data.groups) && matchesFilter(url, filter.pattern, filter.isRegex ?? false)) {
      return true;
    }
  }
  
  return false;
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    try {
      const blocked = await shouldBlockUrl(tab.url);
      
      if (blocked) {
        const blockedUrl = `${chrome.runtime.getURL('blocked.html')}?url=${encodeURIComponent(tab.url)}`;
        await chrome.tabs.update(tabId, { url: blockedUrl });
      }
    } catch (error) {
      console.error('Error checking URL for blocking:', error);
    }
  }
});

chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId === 0) { // Only check main frame
    try {
      const blocked = await shouldBlockUrl(details.url);
      
      if (blocked) {
        const blockedUrl = `${chrome.runtime.getURL('blocked.html')}?url=${encodeURIComponent(details.url)}`;
        await chrome.tabs.update(details.tabId, { url: blockedUrl });
      }
    } catch (error) {
      console.error('Error checking URL for blocking:', error);
    }
  }
});

console.log('Teichos background service worker initialized');
