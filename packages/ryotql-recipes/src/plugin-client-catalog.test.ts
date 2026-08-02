import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { pluginClientCatalogRecipe } from "./plugin-client-catalog";
import { rowsResult } from "./test-utils";

const entry = {
	slug: "fixture",
	health: "ready",
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-1",
	clientCapabilities: [],
	sourceHash: "source-hash",
	installationId: "installation-1",
	clientArtifactHash: "artifact-hash",
};

const response = {
	data: {
		installations: rowsResult([entry], { hasMore: false, limit: 100, nextCursor: null }),
	},
};

describe("plugin client catalog recipe", () => {
	it("joins installations to their plugin", () => {
		const document = pluginClientCatalogRecipe().document;

		expect(document.queries.installations).toMatchObject({
			output: { pagination: { limit: 100 } },
			from: { alias: "installation", table: "pluginInstallation" },
			joins: [{ type: "inner", table: { alias: "plugin", table: "plugin" } }],
		});
	});

	it("decodes installations with their client artifact identity", () => {
		expect(Result.getOrThrow(pluginClientCatalogRecipe().decode(response))).toEqual([entry]);
	});

	it("decodes plugins without a compiled client artifact", () => {
		const decoded = pluginClientCatalogRecipe().decode({
			data: {
				installations: rowsResult(
					[
						{
							...entry,
							clientApiVersion: null,
							clientCapabilities: null,
							clientArtifactHash: null,
						},
					],
					{ hasMore: false, limit: 100, nextCursor: null },
				),
			},
		});

		expect(Result.getOrThrow(decoded)[0]).toMatchObject({
			clientApiVersion: null,
			clientCapabilities: null,
			clientArtifactHash: null,
		});
	});

	it("rejects an unknown installation health", () => {
		expect(
			Result.isFailure(
				pluginClientCatalogRecipe().decode({
					data: {
						installations: rowsResult([{ ...entry, health: "unknown" }], {
							limit: 100,
							hasMore: false,
							nextCursor: null,
						}),
					},
				}),
			),
		).toBe(true);
	});
});
