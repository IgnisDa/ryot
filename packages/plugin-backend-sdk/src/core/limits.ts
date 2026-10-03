export const GLOBAL_WRITE_SANDBOX_LIMITS = {
	entityItems: 500,
	relationshipGroups: 50,
	relationshipsTotal: 1_000,
	relationshipsPerGroup: 500,
} as const;
export const EVENT_MUTATION_SANDBOX_LIMITS = { items: 100 } as const;
export const USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS = {
	batches: 50,
	changesTotal: 500,
	changesPerBatch: 100,
} as const;
export const ENTITY_EDITOR_SANDBOX_LIMITS = {
	relationshipTargets: 200,
	relationshipChanges: USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS.changesPerBatch,
} as const;
export const USER_ENTITY_WRITE_SANDBOX_LIMITS = {
	items: GLOBAL_WRITE_SANDBOX_LIMITS.entityItems,
} as const;
export const USER_ENTITY_READ_SANDBOX_LIMITS = {
	ids: GLOBAL_WRITE_SANDBOX_LIMITS.entityItems,
} as const;
export const MANAGED_ASSET_VERIFY_SANDBOX_LIMITS = { locators: 500 } as const;
