import type { ProviderDetailsRelatedEntity } from "@ryot-app/plugin-backend-sdk/provider";

export type RoleRelatedEntity = Omit<
	ProviderDetailsRelatedEntity,
	"name" | "relationshipProperties"
> & {
	name: string;
	relationshipProperties: {
		order?: number;
		roles: string[];
		isGuest?: boolean;
		character?: string;
		creditKinds?: string[];
		departments?: string[];
		isUncredited?: boolean;
	};
};

const mergeFlag = (existing: boolean | undefined, incoming: boolean | undefined) => {
	if (existing === undefined) {
		return incoming;
	}
	if (incoming === undefined) {
		return existing;
	}
	return existing && incoming;
};

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
			const relationshipProperties = {
				...entity.relationshipProperties,
				roles: [...new Set(entity.relationshipProperties.roles)],
			};
			if (character) {
				relationshipProperties.character = character;
			} else {
				delete relationshipProperties.character;
			}
			if (relationshipProperties.creditKinds !== undefined) {
				relationshipProperties.creditKinds = [...new Set(relationshipProperties.creditKinds)];
			}
			if (relationshipProperties.departments !== undefined) {
				relationshipProperties.departments = [...new Set(relationshipProperties.departments)];
			}
			const first: RoleRelatedEntity = { ...entity, relationshipProperties };
			byKey.set(key, first);
			entities.push(first);
			return;
		}
		for (const role of entity.relationshipProperties.roles) {
			if (!existing.relationshipProperties.roles.includes(role)) {
				existing.relationshipProperties.roles.push(role);
			}
		}
		for (const property of ["creditKinds", "departments"] as const) {
			const values = entity.relationshipProperties[property];
			if (values !== undefined) {
				const existingValues = existing.relationshipProperties[property] ?? [];
				existing.relationshipProperties[property] = existingValues;
				for (const value of values) {
					if (!existingValues.includes(value)) {
						existingValues.push(value);
					}
				}
			}
		}
		const order = entity.relationshipProperties.order;
		if (order !== undefined) {
			existing.relationshipProperties.order =
				existing.relationshipProperties.order === undefined
					? order
					: Math.min(existing.relationshipProperties.order, order);
		}
		for (const property of ["isGuest", "isUncredited"] as const) {
			const value = mergeFlag(
				existing.relationshipProperties[property],
				entity.relationshipProperties[property],
			);
			if (value === undefined) {
				delete existing.relationshipProperties[property];
			} else {
				existing.relationshipProperties[property] = value;
			}
		}
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
