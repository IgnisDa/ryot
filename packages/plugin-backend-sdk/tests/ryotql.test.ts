import { describe, expect, it } from "bun:test";

import { PluginId } from "@ryot-app/contract/schema/brands";
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { PluginExecutionRequest } from "@ryot-app/plugin-backend-sdk/ryotql";
import {
	column,
	document,
	entityReadRecipe,
	eventReadRecipe,
	executeRyotqlRecipe,
	field,
	rows,
	table,
	userMediaLibraryRecipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

const rowsResponse = {
	data: {
		entities: {
			type: "rows" as const,
			pageInfo: { limit: 100, hasMore: false, nextCursor: null },
			items: [
				{
					name: "Item",
					id: "entity-1",
					externalId: null,
					providerId: null,
					populatedAt: null,
					entitySchemaSlug: "item",
					properties: { pages: 320 },
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-02T00:00:00Z",
					entitySchemaPluginId: "item-owner",
				},
			],
		},
	},
};

describe("RyotQL sandbox SDK", () => {
	it("re-exports shared builders and sandbox recipe factories", () => {
		const entity = table("entity", "entity");
		expect(
			document({ entities: rows(entity, { fields: [field("id", column(entity, "id"))] }) }),
		).toMatchObject({ queries: { entities: { from: entity } } });
		expect(entityReadRecipe.document).toMatchObject({
			queries: { entities: { from: entity, output: { type: "rows", pagination: { limit: 100 } } } },
		});
		expect(
			eventReadRecipe({
				entitySchemaSlug: "item",
				eventSchemaSlug: "progress",
				owner: { kind: "local", pluginId: PluginId.make("item-owner") },
			}).document,
		).toHaveProperty("queries.events");
		expect(userMediaLibraryRecipe({ kind: "self" }).document).toHaveProperty(
			"queries.mediaLibrary",
		);
	});

	it("executes and decodes a prepared recipe", () => {
		const recipe = entityReadRecipe;
		const executeRyotql = (request: PluginExecutionRequest) => {
			expect(request).toEqual({
				arguments: { entityIds: ["entity-1"] },
				source: { kind: "inline", document: recipe.document },
			});
			return Effect.succeed(rowsResponse);
		};

		return expect(
			Effect.runPromise(executeRyotqlRecipe(executeRyotql, recipe, { entityIds: ["entity-1"] })),
		).resolves.toMatchObject({ items: [{ id: "entity-1", properties: { pages: 320 } }] });
	});

	it("lifts recipe decoder failures into Effect", () => {
		const recipe = entityReadRecipe;

		return expect(
			Effect.runPromise(
				executeRyotqlRecipe(
					() => Effect.succeed({ data: { entities: { type: "aggregate" } } }),
					recipe,
					{ entityIds: ["entity-1"] },
				),
			),
		).rejects.toBeTruthy();
	});

	it("keeps executeRyotql as a generic host transport", () => {
		const manifest = defineManifest({
			kind: "script",
			name: "RyotQL reader",
			slug: "ryotql-reader",
		});
		const definition = defineScript({
			manifest,
			output: Schema.Finite,
			input: Schema.Struct({}),
			run: (_input, host) =>
				executeRyotqlRecipe(host.executeRyotql, entityReadRecipe, { entityIds: ["entity-1"] }).pipe(
					Effect.map((response) => response.items.length),
				),
		});
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => Effect.succeed(rowsResponse),
		});

		return expect(
			Effect.runPromise(
				runSandboxTestScript(definition, {}, host, { metadata: {}, sandboxScriptId: "script-1" }),
			),
		).resolves.toBe(1);
	});
});
