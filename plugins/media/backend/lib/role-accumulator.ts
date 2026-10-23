import type { ProviderDetailsRelatedEntity } from "@ryot-app/plugin-backend-sdk/provider";

export type RoleRelatedEntity = Omit<
	ProviderDetailsRelatedEntity,
	"name" | "relationshipProperties"
> & { name: string; relationshipProperties: { roles: string[]; character?: string } };

export const createRoleAccumulator = (initial: readonly RoleRelatedEntity[] = []) => {
	const entities: RoleRelatedEntity[] = [];
	const byKey = new Map<string, RoleRelatedEntity>();
	const charactersByKey = new Map<string, Set<string>>();
	const add = (entity: RoleRelatedEntity) => {
		const key = `${entity.providerSlug}:${entity.externalId}`;
		const character = entity.relationshipProperties.character?.trim();
		if (character) {
			const characters = charactersByKey.get(key) ?? new Set<string>();
			characters.add(character);
			charactersByKey.set(key, characters);
		}
		const existing = byKey.get(key);
		if (!existing) {
			if (character) {
				entity.relationshipProperties.character = character;
			}
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
		const characters = charactersByKey.get(key);
		if (characters !== undefined) {
			existing.relationshipProperties.character = [...characters].join(" / ");
		}
		if (existing.name === "Loading..." && entity.name !== "Loading...") {
			existing.name = entity.name;
		}
	};
	for (const entity of initial) {
		add(entity);
	}
	return { add, entities };
};
