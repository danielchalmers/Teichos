import type { ExtensionMessage, MessageResponse } from '../types';

export async function sendExtensionMessage<T extends ExtensionMessage>(
  message: T
): Promise<MessageResponse<T>> {
  return (await chrome.runtime.sendMessage(message)) as MessageResponse<T>;
}
