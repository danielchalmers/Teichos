import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleInstalled } from '../../../src/background/handlers/install';
import { getChromeMock } from '../../fixtures/chrome-mocks';

describe('install handler', () => {
  afterEach(() => {
    getChromeMock().extension.inIncognitoContext = false;
  });

  it('opens Settings when Teichos is first installed', () => {
    handleInstalled({ reason: 'install' });

    expect(getChromeMock().runtime.openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it.each<chrome.runtime.InstalledDetails>([
    { reason: 'update', previousVersion: '0.9.0' },
    { reason: 'chrome_update' },
    { reason: 'shared_module_update', id: 'shared-module-id' },
  ])('opens nothing for $reason', (details) => {
    handleInstalled(details);

    expect(getChromeMock().runtime.openOptionsPage).not.toHaveBeenCalled();
  });

  it('opens nothing from the Incognito instance, which is sent the event too', () => {
    getChromeMock().extension.inIncognitoContext = true;

    handleInstalled({ reason: 'install' });

    expect(getChromeMock().runtime.openOptionsPage).not.toHaveBeenCalled();
  });

  it('logs a failure to open Settings instead of leaving the rejection unhandled', async () => {
    // As when Teichos is installed while the browser has no window to put the tab in.
    const failure = new Error('Could not create an options page.');
    getChromeMock().runtime.openOptionsPage.mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    handleInstalled({ reason: 'install' });

    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith(
        '[Teichos] Error opening Settings after install:',
        failure
      );
    });
  });
});
