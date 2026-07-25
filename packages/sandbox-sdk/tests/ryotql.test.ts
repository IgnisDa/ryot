import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";
import {
	buildEntityReadDocument,
	column,
	document,
	field,
	rows,
	ryotqlRows,
	table,
} from "@ryot/sandbox-sdk/ryotql";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

const rowsResponse = {
	data: {
		entities: {
			type: "rows" as const,
			pageInfo: { page: 1, limit: 20, total: 1, hasMore: false },
			items: [{ id: { kind: "text" as const, value: "entity-1" } }],
		},
	},
};

describe("RyotQL sandbox SDK", () => {
	it("re-exports shared builders and sandbox recipes", () => {
		const entity = table("entity", "entity");
		expect(
			document({ entities: rows(entity, { fields: [field("id", column(entity, "id"))] }) }),
		).toMatchObject({ queries: { entities: { from: entity } } });
		expect(
			buildEntityReadDocument({ entityIds: ["entity-1"], entitySchemaSlugs: ["movie"] }),
		).toMatchObject({
			queries: {
				entities: { from: entity, output: { type: "rows", pagination: { page: 1, limit: 100 } } },
			},
		});
	});

	it("strictly decodes only named RyotQL row envelopes", () => {
		expect(ryotqlRows(rowsResponse, "entities").items).toEqual([
			{ id: { kind: "text", value: "entity-1" } },
		]);
		expect(() =>
			ryotqlRows({ type: "rows", data: rowsResponse.data.entities }, "entities"),
		).toThrow();
		expect(() =>
			ryotqlRows(
				{
					data: {
						entities: {
							...rowsResponse.data.entities,
							items: [{ id: { kind: "text", value: 1 } }],
						},
					},
				},
				"entities",
			),
		).toThrow();
	});

	it("exposes executeRyotql as its own host capability", async () => {
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
				host
					.executeRyotql(
						buildEntityReadDocument({ entityIds: ["entity-1"], entitySchemaSlugs: ["movie"] }),
					)
					.pipe(Effect.map((response) => ryotqlRows(response, "entities").items.length)),
		});
		const host = defineSandboxTestHost(manifest, {
			executeRyotql: () => Effect.succeed(rowsResponse),
		});

		await expect(
			Effect.runPromise(
				runSandboxTestScript(definition, {}, host, {
					metadata: {},
					sandboxScriptId: "script-1",
				}),
			),
		).resolves.toBe(1);
	});
});
