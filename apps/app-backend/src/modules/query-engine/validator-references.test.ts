import { expect, it } from "@effect/vitest";
import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
} from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import {
	DefinitionRegistry,
	makeDefinitionRegistry,
	type DefinitionSource,
} from "#modules/definition-registry/service";

import type { QueryExecutionScope } from "./execution-scope";
import { validateQueryDocumentReferencesAndTypes } from "./validator/references";

const entitySchema = (
	slug: string,
	eventSchemas: readonly string[] = [],
	pluginSlug = "fixture",
) => ({
	slug,
	name: slug,
	pluginSlug,
	icon: "test",
	accentColor: "#000000",
	propertiesSchema: { fields: {} },
	eventSchemas: eventSchemas.map((eventSlug) => ({
		name: eventSlug,
		slug: eventSlug,
		propertiesSchema: { fields: {} },
	})),
});

const definitions: DefinitionSource = {
	savedViews: [],
	signalSchemas: [],
	entitySchemas: [
		entitySchema("owned-a", ["status"]),
		entitySchema("owned-b", ["status"]),
		entitySchema("library", ["private-event"], "other-plugin"),
		entitySchema("foreign", [], "other-plugin"),
	],
	relationshipSchemas: [
		{
			name: "Owned link",
			slug: "owned-link",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "owned-a",
			targetEntitySchemaSlug: "library",
		},
		{
			name: "Foreign link",
			slug: "foreign-link",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "owned-a",
			targetEntitySchemaSlug: "owned-b",
		},
	],
};

const scope: QueryExecutionScope = {
	type: "system",
	pluginSlug: PluginSlug.make("fixture"),
	relationshipSchemaSlugs: [RelationshipSchemaSlug.make("owned-link")],
	entitySchemaSlugs: [EntitySchemaSlug.make("owned-a"), EntitySchemaSlug.make("owned-b")],
	eventSchemas: [
		{
			entitySchemaSlug: EntitySchemaSlug.make("owned-a"),
			eventSchemaSlug: EventSchemaSlug.make("status"),
		},
	],
};

const rows = (where: QueryDocument["source"]["where"]): QueryDocument => ({
	source: { type: "entities", alias: "root", schemas: ["owned-a"], where },
	output: {
		fields: [],
		type: "rows",
		pagination: { page: 1, limit: 10 },
		orderBy: [{ order: "asc", expr: { type: "literal", value: 1 } }],
	},
});

const reject = (doc: QueryDocument) =>
	Effect.flip(validateQueryDocumentReferencesAndTypes(scope, doc)).pipe(
		Effect.provideService(DefinitionRegistry, {
			...makeDefinitionRegistry(definitions),
		}),
	);

const accept = (executionScope: QueryExecutionScope, doc: QueryDocument) =>
	validateQueryDocumentReferencesAndTypes(executionScope, doc).pipe(
		Effect.provideService(DefinitionRegistry, {
			...makeDefinitionRegistry(definitions),
		}),
	);

it.effect("allows a user-owned endpoint through an owned compatible relationship", () =>
	accept(
		scope,
		rows({
			type: "exists",
			source: {
				where: null,
				type: "entities",
				alias: "library",
				schemas: ["library"],
				via: { alias: "link", entityRef: "root", schema: "owned-link", direction: "outgoing" },
			},
		}),
	),
);

it.effect("rejects an unowned relationship schema in a nested source", () =>
	Effect.gen(function* () {
		const error = yield* reject(
			rows({
				type: "exists",
				source: {
					where: null,
					type: "entities",
					alias: "related",
					schemas: ["owned-b"],
					via: { alias: "link", entityRef: "root", direction: "outgoing", schema: "foreign-link" },
				},
			}),
		);

		expect(error.message).toBe("Relationship schema 'foreign-link' not found");
	}),
);

it.effect("rejects an unowned entity schema in a nested source", () =>
	Effect.gen(function* () {
		const error = yield* reject(
			rows({
				type: "exists",
				source: { where: null, type: "entities", alias: "foreign", schemas: ["foreign"] },
			}),
		);

		expect(error.message).toBe("Entity schema 'foreign' not found");
	}),
);

it.effect("rejects an endpoint schema not allowed by the owned relationship", () =>
	Effect.gen(function* () {
		const error = yield* reject(
			rows({
				type: "exists",
				source: {
					where: null,
					type: "entities",
					alias: "related",
					schemas: ["owned-b"],
					via: { alias: "link", entityRef: "root", schema: "owned-link", direction: "outgoing" },
				},
			}),
		);

		expect(error.message).toBe(
			"Entity schema 'owned-b' is not allowed as the target endpoint of relationship schema 'owned-link'",
		);
	}),
);

it.effect("does not extend endpoint visibility to nested event schemas", () =>
	Effect.gen(function* () {
		const error = yield* reject(
			rows({
				type: "exists",
				source: {
					type: "entities",
					alias: "library",
					schemas: ["library"],
					via: { alias: "link", entityRef: "root", schema: "owned-link", direction: "outgoing" },
					where: {
						type: "exists",
						source: {
							where: null,
							type: "events",
							alias: "event",
							entityRef: "library",
							schemas: ["private-event"],
						},
					},
				},
			}),
		);

		expect(error.message).toBe("Event schema 'private-event' not found");
	}),
);

it.effect("preserves user access to schemas without plugin ownership", () =>
	accept(
		{ type: "user", userId: "user-1" },
		{
			...rows(null),
			source: { type: "entities", alias: "root", schemas: ["library"], where: null },
		},
	),
);

it.effect("preserves user traversal validation behavior", () =>
	accept(
		{ type: "user", userId: "user-1" },
		rows({
			type: "exists",
			source: {
				where: null,
				type: "entities",
				alias: "related",
				schemas: ["owned-b"],
				via: { alias: "link", entityRef: "root", schema: "owned-link", direction: "outgoing" },
			},
		}),
	),
);

it.effect("rejects a same-slug event schema not owned for every selected entity schema", () =>
	Effect.gen(function* () {
		const doc = rows({
			type: "exists",
			source: {
				where: null,
				type: "events",
				alias: "event",
				entityRef: "root",
				schemas: ["status"],
			},
		});
		const error = yield* reject({
			...doc,
			source: {
				...doc.source,
				alias: "root",
				type: "entities",
				schemas: ["owned-a", "owned-b"],
				where: {
					type: "exists",
					source: {
						where: null,
						type: "events",
						alias: "event",
						entityRef: "root",
						schemas: ["status"],
					},
				},
			},
		});

		expect(error.message).toBe("Event schema 'status' not found");
	}),
);

it.effect("rejects unowned root entity, event, and relationship schemas", () =>
	Effect.gen(function* () {
		const entityError = yield* reject({
			...rows(null),
			source: { type: "entities", alias: "root", schemas: ["foreign"], where: null },
		});
		const eventError = yield* reject({
			source: {
				where: null,
				type: "events",
				alias: "event",
				schemas: ["status"],
				entity: { alias: "entity", schemas: ["owned-b"] },
			},
			output: rows(null).output,
		});
		const relationshipError = yield* reject({
			source: {
				where: null,
				alias: "link",
				type: "relationships",
				schemas: ["foreign-link"],
				sourceEntity: { alias: "source", schemas: ["owned-a"] },
				targetEntity: { alias: "target", schemas: ["owned-b"] },
			},
			output: rows(null).output,
		});

		expect(entityError.message).toBe("Entity schema 'foreign' not found");
		expect(eventError.message).toBe("Event schema 'status' not found");
		expect(relationshipError.message).toBe("Relationship schema 'foreign-link' not found");
	}),
);
