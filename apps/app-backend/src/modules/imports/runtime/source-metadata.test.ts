import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { makeConfigProviderLayer } from "#lib/test-utils/effect";
import type { RegisteredImportSource } from "#modules/plugins/import-source-catalog";

import {
	buildImportInputSummary,
	buildImportSourcePayload,
	parseRegistryImportSourceInput,
	registryImportSourceFileInputs,
	registryImportSourceMissingConfigKeys,
} from "./source-metadata";

const configSchema = {
	unknownKeys: "strict",
	fields: {
		tmdbAccessToken: {
			type: "string",
			label: "TMDB access token",
			description: "TMDB access token",
		},
		hardcoverApiKey: {
			type: "string",
			label: "Hardcover API key",
			description: "Hardcover API key",
		},
	},
} as const;

const uploadProperty = (allowedFileExtensions: ReadonlyArray<string>, required = true) => ({
	label: "Export file",
	type: "string" as const,
	description: "Export file",
	format: { kind: "upload" as const, allowedFileExtensions },
	...(required ? { validation: { minLength: 1 as const, required: true as const } } : {}),
});

const registeredSource = (
	overrides: Partial<RegisteredImportSource> = {},
): RegisteredImportSource => ({
	configSchema,
	name: "Netflix",
	slug: "netflix",
	pluginSlug: "media",
	requiredPluginConfigKeys: [],
	description: "Netflix export",
	workflowSlug: "netflix-import",
	inputSchema: {
		unknownKeys: "strict",
		fields: {
			uploadToken: uploadProperty(["zip"]),
			profileName: { type: "string", label: "Profile name", description: "Profile name" },
		},
	},
	...overrides,
});

it.effect("returns only the visible required upload after schema parsing", () =>
	Effect.gen(function* () {
		const source = registeredSource({
			inputSchema: {
				unknownKeys: "strict",
				fields: {
					historyUploadToken: uploadProperty(["csv"]),
					ratingsUploadToken: uploadProperty(["json"]),
					mode: {
						type: "enum",
						label: "Import mode",
						description: "Import mode",
						validation: { required: true },
						choices: { kind: "static", values: [{ value: "history" }, { value: "ratings" }] },
					},
				},
				rules: [
					{
						kind: "visibility",
						path: ["ratingsUploadToken"],
						visibility: { hidden: true },
						when: { operator: "eq", path: ["mode"], value: "history" },
					},
					{
						kind: "visibility",
						path: ["historyUploadToken"],
						visibility: { hidden: true },
						when: { operator: "eq", path: ["mode"], value: "ratings" },
					},
				],
			},
		});
		const properties = yield* parseRegistryImportSourceInput(source, {
			mode: "history",
			source: "netflix",
			historyUploadToken: "history",
		});

		expect(registryImportSourceFileInputs(source, properties)).toEqual([
			{ key: "historyUploadToken", uploadToken: "history", allowedExtensions: ["csv"] },
		]);
	}),
);

it("orders upload inputs by position with unpositioned fields last", () => {
	const source = registeredSource({
		inputSchema: {
			unknownKeys: "strict",
			fields: {
				lastUploadToken: uploadProperty(["json"], false),
				secondUploadToken: { ...uploadProperty(["csv"], false), position: 2 },
				firstUploadToken: { ...uploadProperty(["zip"], false), position: 1 },
			},
		},
	});
	expect(
		registryImportSourceFileInputs(source, {
			lastUploadToken: "last",
			firstUploadToken: "first",
			secondUploadToken: "second",
		}).map(({ key }) => key),
	).toEqual(["firstUploadToken", "secondUploadToken", "lastUploadToken"]);
});

it.effect("rejects undeclared upload token fields before schema parsing", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(registeredSource(), {
				source: "netflix",
				historyUploadToken: "not-even-a-token",
			}),
		);
		expect(error).toBe("Import source does not declare upload token field: historyUploadToken");
	}),
);

it.effect("rejects reserved internal fields before schema parsing", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(registeredSource(), {
				source: "netflix",
				integrationScriptSlug: "integration.spoofed",
			}),
		);
		expect(error).toBe("Import source payload field is reserved: integrationScriptSlug");
	}),
);

it.effect("formats schema validation failures", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(registeredSource(), { source: "netflix" }),
		);
		expect(error).toContain("Import source input is invalid:");
		expect(error).toContain("uploadToken");
	}),
);

const myanimelistSource = () =>
	registeredSource({
		slug: "myanimelist",
		inputSchema: {
			unknownKeys: "strict",
			fields: {
				animeUploadToken: uploadProperty(["xml"], false),
				mangaUploadToken: uploadProperty(["xml"], false),
			},
			rules: [
				{
					kind: "validation",
					path: ["animeUploadToken"],
					validation: { required: true },
					when: { path: ["mangaUploadToken"], operator: "not_exists" },
				},
				{
					kind: "validation",
					path: ["mangaUploadToken"],
					validation: { required: true },
					when: { path: ["animeUploadToken"], operator: "not_exists" },
				},
			],
		},
	});

it.effect("rejects explicit nulls that would leave every conditional upload absent", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(myanimelistSource(), {
				source: "myanimelist",
				animeUploadToken: null,
				mangaUploadToken: null,
			}),
		);
		expect(error).toContain("animeUploadToken is required");
		expect(error).toContain("mangaUploadToken is required");
	}),
);

it.effect("accepts a single conditional upload token and leaves the sibling null", () =>
	Effect.gen(function* () {
		const source = myanimelistSource();
		const properties = yield* parseRegistryImportSourceInput(source, {
			source: "myanimelist",
			mangaUploadToken: null,
			animeUploadToken: "anime",
		});

		expect(registryImportSourceFileInputs(source, properties)).toEqual([
			{ key: "animeUploadToken", uploadToken: "anime", allowedExtensions: ["xml"] },
		]);
	}),
);

it.effect("rejects an upload token carried as an object", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(registeredSource(), {
				source: "netflix",
				uploadToken: { token: "netflix", expiresAt: "2026-08-23T00:00:00.000Z" },
			}),
		);
		expect(error).toContain("Import source input is invalid:");
		expect(error).toContain("uploadToken");
	}),
);

it.effect("rejects an empty required upload token", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(registeredSource(), { source: "netflix", uploadToken: "" }),
		);
		expect(error).toContain("uploadToken");
	}),
);

it.effect("builds payload from decoded properties and replaces upload tokens with markers", () =>
	Effect.gen(function* () {
		const source = registeredSource();
		const properties = yield* parseRegistryImportSourceInput(source, {
			source: "netflix",
			profileName: "Kids",
			uploadToken: "netflix",
		});

		expect(buildImportSourcePayload(properties, source)).toEqual({
			profileName: "Kids",
			uploadToken: "uploadToken",
		});
	}),
);

it("summarizes only source and claimed original file names", () => {
	expect(
		buildImportInputSummary("movary", {
			historyUploadToken: "history.csv",
			ratingsUploadToken: "ratings.csv",
		}),
	).toEqual({
		source: "movary",
		fileNames: { historyUploadToken: "history.csv", ratingsUploadToken: "ratings.csv" },
	});
	expect(buildImportInputSummary("trakt", {})).toEqual({ source: "trakt" });
});

it.effect("formats every un-configured plugin config key", () =>
	Effect.gen(function* () {
		const source = registeredSource({
			requiredPluginConfigKeys: ["tmdbAccessToken", "hardcoverApiKey"],
		});
		expect(yield* registryImportSourceMissingConfigKeys(source)).toEqual([
			"RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN",
			"RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY",
		]);
	}).pipe(Effect.provide(makeConfigProviderLayer())),
);
