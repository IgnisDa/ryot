import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
import {
	column,
	document,
	entityReadRecipe,
	eventReadRecipe,
	executeRyotqlRecipe,
	field,
	rows,
	table,
	userLibraryRecipe,
} from "@ryot-app/sandbox-sdk/ryotql";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

const rowsResponse = {
	data: {
		entities: {
			type: "rows" as const,
			pageInfo: { limit: 100, hasMore: false, nextCursor: null },
			items: [
				{
					id: "entity-1",
					name: "Book",
					externalId: null,
					providerId: null,
					populatedAt: null,
					properties: { pages: 320 },
					entitySchemaSlug: "book",
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-02T00:00:00Z",
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
		expect(entityReadRecipe({ entityIds: ["entity-1"] }).document).toMatchObject({
			queries: { entities: { from: entity, output: { type: "rows", pagination: { limit: 100 } } } },
		});
		expect(
			eventReadRecipe({ entitySchemaSlug: "book", eventSchemaSlug: "progress" }).document,
		).toHaveProperty("queries.events");
		expect(userLibraryRecipe().document).toHaveProperty("queries.library");
	});

	it("executes and decodes a prepared recipe", async () => {
		const recipe = entityReadRecipe({ entityIds: ["entity-1"] });
		const executeRyotql = (queryDocument: typeof recipe.document) => {
			expect(queryDocument).toBe(recipe.document);
			return Effect.succeed(rowsResponse);
		};

		await expect(
			Effect.runPromise(executeRyotqlRecipe(executeRyotql, recipe)),
		).resolves.toMatchObject({ items: [{ id: "entity-1", properties: { pages: 320 } }] });
	});

	it("lifts recipe decoder failures into Effect", async () => {
		const recipe = entityReadRecipe({ entityIds: ["entity-1"] });

		await expect(
			Effect.runPromise(
				executeRyotqlRecipe(
					() => Effect.succeed({ data: { entities: { type: "aggregate" } } }),
					recipe,
				),
			),
		).rejects.toBeTruthy();
	});

	it("keeps executeRyotql as a generic host transport", async () => {
		const manifest = defineManifest({
			kind: "script",
			name: "RyotQL reader",
			slug: "ryotql-reader",
			requiredPluginConfigKeys: [],
			requiredSystemConfigKeys: [],
			capabilities: ["executeRyotql"],
		});
		const definition = defineScript({
			manifest,
			output: Schema.Number,
			input: Schema.Struct({}),
			run: (_input, host) =>
				executeRyotqlRecipe(host.executeRyotql, entityReadRecipe({ entityIds: ["entity-1"] })).pipe(
					Effect.map((response) => response.items.length),
				),
		});
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => Effect.succeed(rowsResponse),
		});

		await expect(
			Effect.runPromise(
				runSandboxTestScript(definition, {}, host, { metadata: {}, sandboxScriptId: "script-1" }),
			),
		).resolves.toBe(1);
	});
});
