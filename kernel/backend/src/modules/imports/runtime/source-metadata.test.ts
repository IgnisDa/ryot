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
		alphaAccessToken: {
			type: "string",
			label: "Alpha access token",
			description: "Alpha access token",
		},
		deltaApiKey: {
			type: "string",
			label: "Delta API key",
			description: "Delta API key",
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
	name: "Nu",
	slug: "nu",
	pluginSlug: "example",
	pluginScope: "system",
	pluginId: "example-plugin-id",
	requiredPluginConfigKeys: [],
	description: "Nu export",
	workflowSlug: "nu-import",
	installationId: "example-installation",
	configContext: { kind: "environment", pluginSlug: "example", configSchema },
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
			source: "nu",
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
				source: "nu",
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
				source: "nu",
				integrationScriptSlug: "integration.spoofed",
			}),
		);
		expect(error).toBe("Import source payload field is reserved: integrationScriptSlug");
	}),
);

it.effect("formats schema validation failures", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(registeredSource(), { source: "nu" }),
		);
		expect(error).toContain("Import source input is invalid:");
		expect(error).toContain("uploadToken");
	}),
);

const epsilonSource = () =>
	registeredSource({
		slug: "epsilon",
		inputSchema: {
			unknownKeys: "strict",
			fields: {
				primaryUploadToken: uploadProperty(["xml"], false),
				secondaryUploadToken: uploadProperty(["xml"], false),
			},
			rules: [
				{
					kind: "validation",
					path: ["primaryUploadToken"],
					validation: { required: true },
					when: { path: ["secondaryUploadToken"], operator: "not_exists" },
				},
				{
					kind: "validation",
					path: ["secondaryUploadToken"],
					validation: { required: true },
					when: { path: ["primaryUploadToken"], operator: "not_exists" },
				},
			],
		},
	});

it.effect("rejects explicit nulls that would leave every conditional upload absent", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(epsilonSource(), {
				source: "epsilon",
				primaryUploadToken: null,
				secondaryUploadToken: null,
			}),
		);
		expect(error).toContain("primaryUploadToken is required");
		expect(error).toContain("secondaryUploadToken is required");
	}),
);

it.effect("accepts a single conditional upload token and leaves the sibling null", () =>
	Effect.gen(function* () {
		const source = epsilonSource();
		const properties = yield* parseRegistryImportSourceInput(source, {
			source: "epsilon",
			secondaryUploadToken: null,
			primaryUploadToken: "primary",
		});

		expect(registryImportSourceFileInputs(source, properties)).toEqual([
			{ key: "primaryUploadToken", uploadToken: "primary", allowedExtensions: ["xml"] },
		]);
	}),
);

it.effect("rejects an upload token carried as an object", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(registeredSource(), {
				source: "nu",
				uploadToken: { token: "nu", expiresAt: "2026-08-23T00:00:00.000Z" },
			}),
		);
		expect(error).toContain("Import source input is invalid:");
		expect(error).toContain("uploadToken");
	}),
);

it.effect("rejects an empty required upload token", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			parseRegistryImportSourceInput(registeredSource(), { source: "nu", uploadToken: "" }),
		);
		expect(error).toContain("uploadToken");
	}),
);

it.effect("builds payload from decoded properties and replaces upload tokens with markers", () =>
	Effect.gen(function* () {
		const source = registeredSource();
		const properties = yield* parseRegistryImportSourceInput(source, {
			source: "nu",
			profileName: "Kids",
			uploadToken: "nu",
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
	expect(buildImportInputSummary("gamma", {})).toEqual({ source: "gamma" });
});

it.effect("formats every un-configured plugin config key", () =>
	Effect.gen(function* () {
		const source = registeredSource({
			requiredPluginConfigKeys: ["alphaAccessToken", "deltaApiKey"],
		});
		expect(yield* registryImportSourceMissingConfigKeys(source)).toEqual([
			"RYOT_PLUGIN_EXAMPLE_ALPHA_ACCESS_TOKEN",
			"RYOT_PLUGIN_EXAMPLE_DELTA_API_KEY",
		]);
	}).pipe(Effect.provide(makeConfigProviderLayer())),
);

it.effect(
	"resolves private plugin config from installation config instead of the environment",
	() =>
		Effect.gen(function* () {
			const source = registeredSource({
				pluginScope: "user",
				pluginSlug: "my-example",
				pluginId: "private-plugin-id",
				installationId: "private-installation",
				requiredPluginConfigKeys: ["alphaAccessToken", "deltaApiKey"],
				configContext: {
					configSchema,
					kind: "installation",
					config: { alphaAccessToken: "installed-token" },
				},
			});
			expect(yield* registryImportSourceMissingConfigKeys(source)).toEqual(["deltaApiKey"]);
		}).pipe(
			Effect.provide(
				makeConfigProviderLayer({ RYOT_PLUGIN_MY_EXAMPLE_DELTA_API_KEY: "environment-key" }),
			),
		),
);
