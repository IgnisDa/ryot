import { PluginId } from "@ryot-app/contract/schema/brands";
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	column,
	document,
	entityReadRecipe,
	eventReadRecipe,
	executeRyotqlRecipe,
	field,
	readAllRyotqlPages,
	rows,
	table,
	userMediaLibraryRecipe,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";
import { describe, expect, it } from "vitest";

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
		expect(entityReadRecipe({ entityIds: ["entity-1"] }).document).toMatchObject({
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
		const recipe = entityReadRecipe({ entityIds: ["entity-1"] });
		const executeRyotql = (queryDocument: typeof recipe.document) => {
			expect(queryDocument).toBe(recipe.document);
			return Effect.succeed(rowsResponse);
		};

		return expect(
			Effect.runPromise(executeRyotqlRecipe(executeRyotql, recipe)),
		).resolves.toMatchObject({ items: [{ id: "entity-1", properties: { pages: 320 } }] });
	});

	it("lifts recipe decoder failures into Effect", () => {
		const recipe = entityReadRecipe({ entityIds: ["entity-1"] });

		return expect(
			Effect.runPromise(
				executeRyotqlRecipe(
					() => Effect.succeed({ data: { entities: { type: "aggregate" } } }),
					recipe,
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
				executeRyotqlRecipe(host.executeRyotql, entityReadRecipe({ entityIds: ["entity-1"] })).pipe(
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

const pageOf = (items: number[], nextCursor: string | null) =>
	Effect.succeed({ items, pageInfo: { nextCursor, hasMore: nextCursor !== null } });

describe("readAllRyotqlPages", () => {
	it("concatenates pages until the cursor ends", () => {
		const afters: Array<string | undefined> = [];
		const pages = new Map([
			[undefined, pageOf([1], "a")],
			["a", pageOf([2], "b")],
			["b", pageOf([3], null)],
		]);
		return expect(
			Effect.runPromise(
				readAllRyotqlPages((after) => {
					afters.push(after);
					return pages.get(after) ?? Effect.die("unexpected cursor");
				}),
			).then((items) => ({ items, afters })),
		).resolves.toEqual({ items: [1, 2, 3], afters: [undefined, "a", "b"] });
	});

	it("dies when a cursor repeats", () =>
		expect(
			Effect.runPromiseExit(readAllRyotqlPages(() => pageOf([1], "a"))).then(({ _tag }) => _tag),
		).resolves.toBe("Failure"));

	it("dies when a continuing page has no cursor", () =>
		expect(
			Effect.runPromiseExit(
				readAllRyotqlPages(() =>
					Effect.succeed({ items: [1], pageInfo: { hasMore: true, nextCursor: null } }),
				),
			).then(({ _tag }) => _tag),
		).resolves.toBe("Failure"));
});
