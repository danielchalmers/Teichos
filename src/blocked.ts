const urlParams = new URLSearchParams(window.location.search);
const blockedUrl = urlParams.get('url') || 'Unknown URL';

document.getElementById('blocked-url')!.textContent = blockedUrl;

document.getElementById('go-back')!.addEventListener('click', () => {
  window.history.back();
});

document.getElementById('open-options')!.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
