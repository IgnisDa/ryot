import { NotFound } from "@ryot/contract/errors";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";

export type VisibleEntityPropertySchema = { slug: string; propertiesSchema: AppSchema };

export const loadVisibleEntityPropertySchemas = Effect.fn("loadVisibleEntityPropertySchemas")(
	function* (_userId: string, slugs: readonly string[]) {
		const definitions = yield* DefinitionRegistry;
		return [...new Set(slugs)].flatMap((slug) => {
			const definition = definitions.getEntitySchema(slug);
			return definition ? [{ slug, propertiesSchema: definition.propertiesSchema }] : [];
		});
	},
);

export const loadVisibleEntitySchemaSlugs = Effect.fn("loadVisibleEntitySchemaSlugs")(function* (
	_userId: string,
) {
	const definitions = yield* DefinitionRegistry;
	return Object.keys(definitions.getSnapshot().entitySchemas);
});

export const loadVisibleEntitySchemas = Effect.fn("loadVisibleEntitySchemas")(function* (
	_userId: string,
	slugs: readonly [string, ...string[]],
) {
	const definitions = yield* DefinitionRegistry;
	const schemas = yield* requireDefinitions(slugs, "Entity", definitions.getEntitySchema);
	return schemas.flatMap(({ id, slug }) => {
		const definition = definitions.getEntitySchema(slug);
		return definition
			? [
					{
						id,
						slug,
						name: definition.name,
						// TODO(plugin-system): Remove with the query-engine compatibility response shape.
						isBuiltin: true,
					},
				]
			: [];
	});
});

export const loadVisibleRelationshipSchema = Effect.fn("loadVisibleRelationshipSchema")(function* (
	_userId: string,
	slug: string,
) {
	const definitions = yield* DefinitionRegistry;
	const definition = definitions.getRelationshipSchema(slug);
	if (!definition) {
		return yield* new NotFound({ message: `Relationship schema '${slug}' not found` });
	}
	return { id: slug, slug };
});

export const loadVisibleRelationshipSchemas = Effect.fn("loadVisibleRelationshipSchemas")(
	function* (_userId: string, slugs: readonly [string, ...string[]]) {
		const definitions = yield* DefinitionRegistry;
		return yield* requireDefinitions(slugs, "Relationship", definitions.getRelationshipSchema);
	},
);

export const loadVisibleEventSchemas = Effect.fn("loadVisibleEventSchemas")(function* (
	_userId: string,
	entitySchemaSlug: string,
	slugs: readonly [string, ...string[]],
) {
	const definitions = yield* DefinitionRegistry;
	return yield* requireDefinitions(slugs, "Event", (slug) =>
		definitions.getEventSchema(entitySchemaSlug, slug),
	);
});

export const loadVisibleEventSchemasForEntitySchemas = Effect.fn(
	"loadVisibleEventSchemasForEntitySchemas",
)(function* (
	_userId: string,
	entitySchemaSlugs: readonly string[],
	slugs: readonly [string, ...string[]],
) {
	const definitions = yield* DefinitionRegistry;
	return yield* requireDefinitions(slugs, "Event", (slug) =>
		entitySchemaSlugs.some((entitySlug) => definitions.getEventSchema(entitySlug, slug))
			? { slug }
			: undefined,
	);
});

const requireDefinitions = (
	slugs: readonly string[],
	kind: string,
	lookup: (slug: string) => unknown,
) =>
	Effect.gen(function* () {
		const uniqueSlugs = [...new Set(slugs)];
		for (const slug of uniqueSlugs) {
			if (!lookup(slug)) {
				return yield* new NotFound({ message: `${kind} schema '${slug}' not found` });
			}
		}
		return uniqueSlugs.map((slug) => ({ id: slug, slug }));
	});
