import { expect, it } from "@effect/vitest";
import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { EntitySchemaSlug, PluginSlug, RelationshipSchemaSlug } from "@ryot/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { CurrentDb, DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import {
	DefinitionRegistry,
	makeDefinitionRegistry,
	type DefinitionSource,
} from "#modules/definition-registry/service";

import { QueryEngineService } from "./service";

const entitySchema = (slug: string, pluginSlug: string | null) => ({
	slug,
	name: slug,
	pluginSlug,
	icon: "test",
	eventSchemas: [],
	accentColor: "#000000",
	propertiesSchema: { fields: {} },
});

const definitions: DefinitionSource = {
	savedViews: [],
	signalSchemas: [],
	entitySchemas: [entitySchema("media", "media"), entitySchema("library", null)],
	relationshipSchemas: [
		{
			name: "Media monitoring",
			slug: "media-monitoring",
			sourceEntitySchemaSlug: null,
			propertiesSchema: { fields: {} },
			targetEntitySchemaSlug: "library",
		},
	],
};

const systemScope = {
	eventSchemas: [],
	pluginSlug: PluginSlug.make("media"),
	entitySchemaSlugs: [EntitySchemaSlug.make("media")],
	relationshipSchemaSlugs: [RelationshipSchemaSlug.make("media-monitoring")],
};

const rows = (
	schemas: [string, ...string[]],
	where: QueryDocument["source"]["where"],
): QueryDocument => ({
	source: { type: "entities" as const, alias: "entity", schemas, where },
	output: {
		fields: [],
		type: "rows" as const,
		pagination: { page: 1, limit: 10 },
		orderBy: [
			{
				order: "asc" as const,
				expr: {
					type: "ref" as const,
					sourceAlias: "entity",
					field: { type: "system" as const, name: "id" as const },
				},
			},
		],
	},
});

const monitoringQuery: QueryDocument = rows(["media"], {
	type: "exists",
	source: {
		where: null,
		type: "entities",
		alias: "library",
		schemas: ["library"],
		via: {
			alias: "monitoring",
			entityRef: "entity",
			direction: "outgoing",
			schema: "media-monitoring",
		},
	},
});

const makeServiceLayer = (sqlStatements: string[]) => {
	const dialect = new PgDialect();
	const db = Object.assign(Object.create(null), {
		execute: (query: Parameters<typeof dialect.sqlToQuery>[0]) => {
			sqlStatements.push(dialect.sqlToQuery(query).sql);
			return Promise.resolve({ rows: [] });
		},
	});
	const provideDb = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, CurrentDb, db);
	const dependencies = Layer.mergeAll(
		Layer.succeed(DbRunner, provideDb),
		Layer.succeed(TransactionRunner, provideDb),
		Layer.succeed(DefinitionRegistry, {
			_tag: "DefinitionRegistry" as const,
			...makeDefinitionRegistry(definitions),
		}),
	);
	return QueryEngineService.Default.pipe(Layer.provide(dependencies));
};

it.effect("executes an owned relationship traversal to a cross-user endpoint", () => {
	const statements: string[] = [];
	return Effect.gen(function* () {
		const service = yield* QueryEngineService;
		const response = yield* service.executeSystem(systemScope, monitoringQuery);

		expect(response).toMatchObject({ data: { items: [] } });
		const query = statements.at(-1);
		expect(query).toContain("relationship");
		expect(query).toContain("e.user_id IS NULL");
		expect(query).not.toContain("e1.user_id IS NULL");
	}).pipe(Effect.provide(makeServiceLayer(statements)));
});

it.effect("rejects a user-owned entity as a direct system root", () =>
	Effect.gen(function* () {
		const service = yield* QueryEngineService;
		const error = yield* Effect.flip(service.executeSystem(systemScope, rows(["library"], null)));

		expect(error.message).toBe("Entity schema 'library' not found");
	}).pipe(Effect.provide(makeServiceLayer([]))),
);
