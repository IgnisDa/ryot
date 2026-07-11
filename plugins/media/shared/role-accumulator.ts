import type { ProviderDetailsRelatedEntity } from "@ryot/sandbox-sdk/provider";

export type RoleRelatedEntity = Omit<
	ProviderDetailsRelatedEntity,
	"name" | "relationshipProperties"
> & {
	name: string;
	relationshipProperties: { roles: string[] };
};

export const createRoleAccumulator = (initial: readonly RoleRelatedEntity[] = []) => {
	const entities: RoleRelatedEntity[] = [];
	const byKey = new Map<string, RoleRelatedEntity>();
	const add = (entity: RoleRelatedEntity) => {
		const key = `${entity.scriptSlug}:${entity.externalId}`;
		const existing = byKey.get(key);
		if (!existing) {
			byKey.set(key, entity);
			entities.push(entity);
			return;
		}
		existing.relationshipProperties.roles = [
			...new Set([
				...existing.relationshipProperties.roles,
				...entity.relationshipProperties.roles,
			]),
		];
		if (existing.name === "Loading..." && entity.name !== "Loading...") {
			existing.name = entity.name;
		}
	};
	for (const entity of initial) {
		add(entity);
	}
	return { entities, add };
};
