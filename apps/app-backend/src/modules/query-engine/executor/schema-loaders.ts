import { NotFound } from "@ryot/contract/errors";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { DefinitionRegistry } from "#modules/definition-registry/service";

import type { QueryExecutionScope } from "../execution-scope";

export type VisibleEntityPropertySchema = { slug: string; propertiesSchema: AppSchema };

const ownsEntitySchema = (scope: QueryExecutionScope, slug: string) =>
	scope.type === "user" || scope.entitySchemaSlugs.includes(slug);

const ownsRelationshipSchema = (scope: QueryExecutionScope, slug: string) =>
	scope.type === "user" || scope.relationshipSchemaSlugs.includes(slug);

const ownsEventSchema = (
	scope: QueryExecutionScope,
	entitySchemaSlug: string,
	eventSchemaSlug: string,
) =>
	scope.type === "user" ||
	scope.eventSchemas.some(
		(owned) =>
			owned.entitySchemaSlug === entitySchemaSlug && owned.eventSchemaSlug === eventSchemaSlug,
	);

export const loadVisibleEntityPropertySchemas = Effect.fn("loadVisibleEntityPropertySchemas")(
	function* (_scope: QueryExecutionScope, slugs: readonly string[]) {
		const definitions = yield* DefinitionRegistry;
		return [...new Set(slugs)].flatMap((slug) => {
			const definition = definitions.getEntitySchema(slug);
			return definition ? [{ slug, propertiesSchema: definition.propertiesSchema }] : [];
		});
	},
);

export const loadVisibleEntitySchemaSlugs = Effect.fn("loadVisibleEntitySchemaSlugs")(function* (
	input: QueryExecutionScope | string,
) {
	const scope = typeof input === "string" ? { type: "user" as const, userId: input } : input;
	const definitions = yield* DefinitionRegistry;
	return Object.keys(definitions.getSnapshot().entitySchemas).filter((slug) =>
		ownsEntitySchema(scope, slug),
	);
});

export const loadVisibleEntitySchemas = Effect.fn("loadVisibleEntitySchemas")(function* (
	scope: QueryExecutionScope,
	slugs: readonly [string, ...string[]],
) {
	const definitions = yield* DefinitionRegistry;
	const schemas = yield* requireDefinitions(slugs, "Entity", (slug) =>
		ownsEntitySchema(scope, slug) ? definitions.getEntitySchema(slug) : undefined,
	);
	return schemas.flatMap(({ id, slug }) => {
		const definition = definitions.getEntitySchema(slug);
		return definition ? [{ id, slug, name: definition.name }] : [];
	});
});

export const loadVisibleRelationshipSchemas = Effect.fn("loadVisibleRelationshipSchemas")(
	function* (scope: QueryExecutionScope, slugs: readonly [string, ...string[]]) {
		const definitions = yield* DefinitionRegistry;
		return yield* requireDefinitions(slugs, "Relationship", (slug) =>
			ownsRelationshipSchema(scope, slug) ? definitions.getRelationshipSchema(slug) : undefined,
		);
	},
);

export const loadRelationshipEndpointEntitySchemas = Effect.fn(
	"loadRelationshipEndpointEntitySchemas",
)(function* (
	scope: QueryExecutionScope,
	relationshipSchemaSlugs: readonly [string, ...string[]],
	endpoint: "source" | "target",
	entitySchemaSlugs: readonly [string, ...string[]],
) {
	const definitions = yield* DefinitionRegistry;
	const relationshipSchemas = yield* requireDefinitions(
		relationshipSchemaSlugs,
		"Relationship",
		(slug) =>
			ownsRelationshipSchema(scope, slug) ? definitions.getRelationshipSchema(slug) : undefined,
	);
	const entitySchemas = yield* requireDefinitions(
		entitySchemaSlugs,
		"Entity",
		definitions.getEntitySchema,
	);
	if (scope.type === "user") {
		return entitySchemas;
	}
	for (const relationshipSchema of relationshipSchemas) {
		const definition = definitions.getRelationshipSchema(relationshipSchema.slug);
		const allowedSchemaSlug =
			endpoint === "source"
				? definition?.sourceEntitySchemaSlug
				: definition?.targetEntitySchemaSlug;
		if (allowedSchemaSlug === null) {
			continue;
		}
		for (const entitySchema of entitySchemas) {
			if (entitySchema.slug !== allowedSchemaSlug) {
				return yield* new NotFound({
					message: `Entity schema '${entitySchema.slug}' is not allowed as the ${endpoint} endpoint of relationship schema '${relationshipSchema.slug}'`,
				});
			}
		}
	}
	return entitySchemas;
});

export const loadVisibleEventSchemas = Effect.fn("loadVisibleEventSchemas")(function* (
	scope: QueryExecutionScope,
	entitySchemaSlug: string,
	slugs: readonly [string, ...string[]],
) {
	const definitions = yield* DefinitionRegistry;
	return yield* requireDefinitions(slugs, "Event", (slug) =>
		ownsEventSchema(scope, entitySchemaSlug, slug)
			? definitions.getEventSchema(entitySchemaSlug, slug)
			: undefined,
	);
});

export const loadVisibleEventSchemasForEntitySchemas = Effect.fn(
	"loadVisibleEventSchemasForEntitySchemas",
)(function* (
	scope: QueryExecutionScope,
	entitySchemaSlugs: readonly string[],
	slugs: readonly [string, ...string[]],
) {
	const definitions = yield* DefinitionRegistry;
	return yield* requireDefinitions(slugs, "Event", (slug) => {
		const matchingEntitySlugs = entitySchemaSlugs.filter((entitySlug) =>
			definitions.getEventSchema(entitySlug, slug),
		);
		return matchingEntitySlugs.length > 0 &&
			matchingEntitySlugs.every((entitySlug) => ownsEventSchema(scope, entitySlug, slug))
			? { slug }
			: undefined;
	});
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
