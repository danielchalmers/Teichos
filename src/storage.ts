import { StorageData, FilterGroup, Filter, Whitelist, createDefaultGroup, DEFAULT_GROUP_ID } from './types';

const STORAGE_KEY = 'pageblock_data';

export async function loadData(): Promise<StorageData> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  
  if (!result[STORAGE_KEY]) {
    const defaultData: StorageData = {
      groups: [createDefaultGroup()],
      filters: [],
      whitelist: [],
    };
    await saveData(defaultData);
    return defaultData;
  }
  
  // Ensure whitelist array exists for backwards compatibility
  const data = result[STORAGE_KEY] as StorageData;
  if (!data.whitelist) {
    data.whitelist = [];
  }
  
  return data;
}

export async function saveData(data: StorageData): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: data });
}

export async function addGroup(group: FilterGroup): Promise<void> {
  const data = await loadData();
  data.groups.push(group);
  await saveData(data);
}

export async function updateGroup(group: FilterGroup): Promise<void> {
  const data = await loadData();
  const index = data.groups.findIndex(g => g.id === group.id);
  if (index !== -1) {
    data.groups[index] = group;
    await saveData(data);
  }
}

export async function deleteGroup(groupId: string): Promise<void> {
  if (groupId === DEFAULT_GROUP_ID) {
    throw new Error('Cannot delete the default 24/7 group');
  }
  
  const data = await loadData();
  data.groups = data.groups.filter(g => g.id !== groupId);
  // Move filters from deleted group to default group
  data.filters.forEach(f => {
    if (f.groupId === groupId) {
      f.groupId = DEFAULT_GROUP_ID;
    }
  });
  await saveData(data);
}

export async function addFilter(filter: Filter): Promise<void> {
  const data = await loadData();
  data.filters.push(filter);
  await saveData(data);
}

export async function updateFilter(filter: Filter): Promise<void> {
  const data = await loadData();
  const index = data.filters.findIndex(f => f.id === filter.id);
  if (index !== -1) {
    data.filters[index] = filter;
    await saveData(data);
  }
}

export async function deleteFilter(filterId: string): Promise<void> {
  const data = await loadData();
  data.filters = data.filters.filter(f => f.id !== filterId);
  await saveData(data);
}

export async function addWhitelist(whitelist: Whitelist): Promise<void> {
  const data = await loadData();
  data.whitelist.push(whitelist);
  await saveData(data);
}

export async function updateWhitelist(whitelist: Whitelist): Promise<void> {
  const data = await loadData();
  const index = data.whitelist.findIndex(w => w.id === whitelist.id);
  if (index !== -1) {
    data.whitelist[index] = whitelist;
    await saveData(data);
  }
}

export async function deleteWhitelist(whitelistId: string): Promise<void> {
  const data = await loadData();
  data.whitelist = data.whitelist.filter(w => w.id !== whitelistId);
  await saveData(data);
}
