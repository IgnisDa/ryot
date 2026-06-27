export const buildUniqueLotEntitySchemaSlugMap = (
	targets: readonly { lot: string; entitySchemaSlug: string }[],
) => {
	const lotToEntitySchemaSlug = new Map<string, string>();
	for (const target of targets) {
		const existing = lotToEntitySchemaSlug.get(target.lot);
		if (existing !== undefined && existing !== target.entitySchemaSlug) {
			throw new Error(
				`Conflicting entity schema slugs for legacy lot "${target.lot}" (${existing} vs ${target.entitySchemaSlug})`,
			);
		}

		lotToEntitySchemaSlug.set(target.lot, target.entitySchemaSlug);
	}

	return lotToEntitySchemaSlug;
};

export const resolveEntityMigrationTargets = <
	T extends { source: string; entitySchemaSlug: string; providerSlug: string | null },
>(
	targets: readonly T[],
	entitySchemaSlugs: Map<string, string>,
	providerIds: Map<string, string>,
	kindLabel: string,
): Array<T & { entitySchemaSlug: string; providerId: string | null }> =>
	targets.map((target) => {
		const entitySchemaSlug = entitySchemaSlugs.get(target.entitySchemaSlug);
		if (entitySchemaSlug === undefined) {
			throw new Error(
				`Missing entity schema id for ${kindLabel} slug "${target.entitySchemaSlug}"`,
			);
		}

		const providerId: string | null =
			target.providerSlug === null ? null : (providerIds.get(target.providerSlug) ?? null);
		if (target.providerSlug !== null && providerId === null) {
			throw new Error(`Missing provider id for slug "${target.providerSlug}"`);
		}

		return { ...target, entitySchemaSlug, providerId };
	});

export const resolveRelationshipMigrationTargets = (input: {
	lotToEntitySchemaSlug: Map<string, string>;
	relationshipSchemaSlugs: Map<string, string>;
	sourceEntitySchemaSlug: "person" | "company";
}) => {
	const targets: Array<{ lot: string; relationshipSchemaSlug: string }> = [];

	for (const [lot, targetEntitySchemaSlug] of input.lotToEntitySchemaSlug.entries()) {
		const relationshipSchemaKey = `${input.sourceEntitySchemaSlug}-to-${targetEntitySchemaSlug}`;
		const relationshipSchemaSlug = input.relationshipSchemaSlugs.get(relationshipSchemaKey);
		if (relationshipSchemaSlug === undefined) {
			throw new Error(`Missing relationship schema id for slug "${relationshipSchemaKey}"`);
		}

		targets.push({ lot, relationshipSchemaSlug });
	}

	return targets;
};

export const requireDefined = <T>(value: T | undefined, message: string): T => {
	if (value === undefined) {
		throw new Error(message);
	}
	return value;
};

export const requireSchemaId = (map: Map<string, string>, slug: string, kind: string) => {
	const id = map.get(slug);
	if (id === undefined) {
		throw new Error(`Missing ${kind} id for slug "${slug}"`);
	}
	return id;
};
