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
	registryImportSourceStartError,
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
	...(required ? { validation: { required: true as const } } : {}),
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
			historyUploadToken: { token: "history", expiresAt: "2026-08-23T00:00:00.000Z" },
		});

		expect(registryImportSourceFileInputs(source, properties)).toEqual([
			{
				key: "historyUploadToken",
				allowedExtensions: ["csv"],
				uploadToken: { token: "history", expiresAt: "2026-08-23T00:00:00.000Z" },
			},
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
	const expiresAt = "2026-08-23T00:00:00.000Z";

	expect(
		registryImportSourceFileInputs(source, {
			lastUploadToken: { expiresAt, token: "last" },
			firstUploadToken: { expiresAt, token: "first" },
			secondUploadToken: { expiresAt, token: "second" },
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

it.effect("builds payload from decoded properties and replaces upload tokens with markers", () =>
	Effect.gen(function* () {
		const source = registeredSource();
		const properties = yield* parseRegistryImportSourceInput(source, {
			source: "netflix",
			profileName: "Kids",
			uploadToken: { token: "netflix", expiresAt: "2026-08-23T00:00:00.000Z" },
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

it.effect("formats every unconfigured plugin config key for starts and listings", () =>
	Effect.gen(function* () {
		const source = registeredSource({
			requiredPluginConfigKeys: ["tmdbAccessToken", "hardcoverApiKey"],
		});
		expect(yield* registryImportSourceMissingConfigKeys(source)).toEqual([
			"RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN",
			"RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY",
		]);
		expect(yield* registryImportSourceStartError(source)).toBe(
			"Netflix importer is not configured. Set RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN, RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY.",
		);
	}).pipe(Effect.provide(makeConfigProviderLayer())),
);

it.effect("accepts a source whose required plugin config keys are all set", () =>
	Effect.gen(function* () {
		expect(
			yield* registryImportSourceStartError(
				registeredSource({ requiredPluginConfigKeys: ["tmdbAccessToken"] }),
			),
		).toBeUndefined();
	}).pipe(
		Effect.provide(makeConfigProviderLayer({ RYOT_PLUGIN_MEDIA_TMDB_ACCESS_TOKEN: "tmdb-token" })),
	),
);
