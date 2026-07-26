export const normalizeEntityIds = (entityIds: readonly string[]) => [...new Set(entityIds)].sort();
