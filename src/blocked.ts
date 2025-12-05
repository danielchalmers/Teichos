const urlParams = new URLSearchParams(window.location.search);
const blockedUrl = urlParams.get('url') ?? 'Unknown URL';

const blockedUrlElement = document.getElementById('blocked-url');
if (blockedUrlElement) {
  blockedUrlElement.textContent = blockedUrl;
}

const goBackButton = document.getElementById('go-back');
if (goBackButton) {
  goBackButton.addEventListener('click', () => {
    window.history.back();
  });
}

const openOptionsButton = document.getElementById('open-options');
if (openOptionsButton) {
  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}
