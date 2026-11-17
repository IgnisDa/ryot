import type { ProviderDetailsRelatedEntity } from "@ryot-app/plugin-backend-sdk/provider";

import type { CreditRoleCode } from "../../shared/credit-roles";

/** Providers only derive unlinked creators' roles, so they always carry a code. */
export type CodedUnlinkedCreator = { name: string; roleCode: CreditRoleCode };

/** A provider's own role name, or a standard role the provider implies without naming it. */
export type CreditRole = { readonly name: string } | { readonly code: CreditRoleCode };

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
		roleCodes?: CreditRoleCode[];
	};
};

export const creditRoleProperties = (
	role: null | CreditRole,
): { roles: string[]; roleCodes?: CreditRoleCode[] } => {
	if (role === null) {
		return { roles: [] };
	}
	return "code" in role ? { roles: [], roleCodes: [role.code] } : { roles: [role.name] };
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

const mergeUnique = <Value>(existing: undefined | readonly Value[], incoming: readonly Value[]) => [
	...new Set([...(existing ?? []), ...incoming]),
];

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
			if (relationshipProperties.roleCodes !== undefined) {
				relationshipProperties.roleCodes = [...new Set(relationshipProperties.roleCodes)];
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
		const merged = existing.relationshipProperties;
		const { roles, roleCodes, creditKinds, departments } = entity.relationshipProperties;
		merged.roles = mergeUnique(merged.roles, roles);
		if (roleCodes !== undefined) {
			merged.roleCodes = mergeUnique(merged.roleCodes, roleCodes);
		}
		if (creditKinds !== undefined) {
			merged.creditKinds = mergeUnique(merged.creditKinds, creditKinds);
		}
		if (departments !== undefined) {
			merged.departments = mergeUnique(merged.departments, departments);
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
