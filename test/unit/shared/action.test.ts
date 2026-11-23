import { describe, expect, it, vi } from 'vitest';

import { isToolbarIconPinned, onToolbarIconPinChange } from '../../../src/shared/api/action';
import { getChromeMock } from '../../fixtures/chrome-mocks';

describe('shared/api/action', () => {
  it.each([
    { isOnToolbar: true, pinned: true },
    { isOnToolbar: false, pinned: false },
  ])('reports isOnToolbar $isOnToolbar as pinned $pinned', async ({ isOnToolbar, pinned }) => {
    getChromeMock().action.getUserSettings.mockResolvedValue({ isOnToolbar });

    await expect(isToolbarIconPinned()).resolves.toBe(pinned);
  });

  it.each([
    { label: 'nothing', settings: undefined },
    { label: 'no isOnToolbar', settings: {} },
    { label: 'an isOnToolbar that is not a boolean', settings: { isOnToolbar: 'no' } },
  ])('counts $label from Chrome as pinned, so nothing asks for a pin', async ({ settings }) => {
    getChromeMock().action.getUserSettings.mockResolvedValue(settings);

    await expect(isToolbarIconPinned()).resolves.toBe(true);
  });

  it('counts a failed read as pinned', async () => {
    getChromeMock().action.getUserSettings.mockRejectedValue(new Error('no action'));

    await expect(isToolbarIconPinned()).resolves.toBe(true);
  });

  it('calls the listener when the pin changes', () => {
    const listener = vi.fn();

    onToolbarIconPinChange(listener);
    getChromeMock().action.onUserSettingsChanged.addListener.mock.calls[0]?.[0]({
      isOnToolbar: true,
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does without the pin event on a Chrome that has none', () => {
    const { action } = getChromeMock();
    const { onUserSettingsChanged } = action;
    Reflect.deleteProperty(action, 'onUserSettingsChanged');

    try {
      expect(() => onToolbarIconPinChange(vi.fn())).not.toThrow();
    } finally {
      action.onUserSettingsChanged = onUserSettingsChanged;
    }
  });
});
