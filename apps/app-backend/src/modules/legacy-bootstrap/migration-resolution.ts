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
	T extends { source: string; entitySchemaSlug: string; sandboxScriptSlug: string | null },
>(
	targets: readonly T[],
	entitySchemaIds: Map<string, string>,
	sandboxScriptIds: Map<string, string>,
	kindLabel: string,
): Array<T & { entitySchemaId: string; sandboxScriptId: string | null }> =>
	targets.map((target) => {
		const entitySchemaId = entitySchemaIds.get(target.entitySchemaSlug);
		if (entitySchemaId === undefined) {
			throw new Error(
				`Missing entity schema id for ${kindLabel} slug "${target.entitySchemaSlug}"`,
			);
		}

		const sandboxScriptId: string | null =
			target.sandboxScriptSlug === null
				? null
				: (sandboxScriptIds.get(target.sandboxScriptSlug) ?? null);
		if (target.sandboxScriptSlug !== null && sandboxScriptId === null) {
			throw new Error(`Missing sandbox script id for slug "${target.sandboxScriptSlug}"`);
		}

		return { ...target, entitySchemaId, sandboxScriptId };
	});

export const resolveRelationshipMigrationTargets = (input: {
	lotToEntitySchemaSlug: Map<string, string>;
	relationshipSchemaIds: Map<string, string>;
	sourceEntitySchemaSlug: "person" | "company";
}) => {
	const targets: Array<{ lot: string; relationshipSchemaId: string }> = [];

	for (const [lot, targetEntitySchemaSlug] of input.lotToEntitySchemaSlug.entries()) {
		const relationshipSchemaSlug = `${input.sourceEntitySchemaSlug}-to-${targetEntitySchemaSlug}`;
		const relationshipSchemaId = input.relationshipSchemaIds.get(relationshipSchemaSlug);
		if (relationshipSchemaId === undefined) {
			throw new Error(`Missing relationship schema id for slug "${relationshipSchemaSlug}"`);
		}

		targets.push({ lot, relationshipSchemaId });
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
