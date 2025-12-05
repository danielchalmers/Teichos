import { StorageData, FilterGroup, Filter, Whitelist, createDefaultGroup, DEFAULT_GROUP_ID } from './types';

const STORAGE_KEY = 'pageblock_data' as const;

export async function loadData(): Promise<StorageData> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  
  const storedData = result[STORAGE_KEY];
  if (!storedData) {
    const defaultData: StorageData = {
      groups: [createDefaultGroup()],
      filters: [],
      whitelist: [],
    };
    await saveData(defaultData);
    return defaultData;
  }
  
  // Ensure whitelist array exists for backwards compatibility
  const data = storedData as StorageData;
  if (!data.whitelist) {
    return {
      ...data,
      whitelist: [],
    };
  }
  
  return data;
}

export async function saveData(data: StorageData): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: data });
}

export async function addGroup(group: FilterGroup): Promise<void> {
  const data = await loadData();
  const newData: StorageData = {
    ...data,
    groups: [...data.groups, group],
  };
  await saveData(newData);
}

export async function updateGroup(group: FilterGroup): Promise<void> {
  const data = await loadData();
  const index = data.groups.findIndex(g => g.id === group.id);
  if (index !== -1) {
    const newGroups = [...data.groups];
    newGroups[index] = group;
    const newData: StorageData = {
      ...data,
      groups: newGroups,
    };
    await saveData(newData);
  }
}

export async function deleteGroup(groupId: string): Promise<void> {
  if (groupId === DEFAULT_GROUP_ID) {
    throw new Error('Cannot delete the default 24/7 group');
  }
  
  const data = await loadData();
  const newData: StorageData = {
    ...data,
    groups: data.groups.filter(g => g.id !== groupId),
    // Move filters from deleted group to default group
    filters: data.filters.map(f => 
      f.groupId === groupId ? { ...f, groupId: DEFAULT_GROUP_ID } : f
    ),
  };
  await saveData(newData);
}

export async function addFilter(filter: Filter): Promise<void> {
  const data = await loadData();
  const newData: StorageData = {
    ...data,
    filters: [...data.filters, filter],
  };
  await saveData(newData);
}

export async function updateFilter(filter: Filter): Promise<void> {
  const data = await loadData();
  const index = data.filters.findIndex(f => f.id === filter.id);
  if (index !== -1) {
    const newFilters = [...data.filters];
    newFilters[index] = filter;
    const newData: StorageData = {
      ...data,
      filters: newFilters,
    };
    await saveData(newData);
  }
}

export async function deleteFilter(filterId: string): Promise<void> {
  const data = await loadData();
  const newData: StorageData = {
    ...data,
    filters: data.filters.filter(f => f.id !== filterId),
  };
  await saveData(newData);
}

export async function addWhitelist(whitelist: Whitelist): Promise<void> {
  const data = await loadData();
  const newData: StorageData = {
    ...data,
    whitelist: [...data.whitelist, whitelist],
  };
  await saveData(newData);
}

export async function updateWhitelist(whitelist: Whitelist): Promise<void> {
  const data = await loadData();
  const index = data.whitelist.findIndex(w => w.id === whitelist.id);
  if (index !== -1) {
    const newWhitelist = [...data.whitelist];
    newWhitelist[index] = whitelist;
    const newData: StorageData = {
      ...data,
      whitelist: newWhitelist,
    };
    await saveData(newData);
  }
}

export async function deleteWhitelist(whitelistId: string): Promise<void> {
  const data = await loadData();
  const newData: StorageData = {
    ...data,
    whitelist: data.whitelist.filter(w => w.id !== whitelistId),
  };
  await saveData(newData);
}
