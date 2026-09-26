import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

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
		deltaApiKey: { type: "string", label: "Delta API key", description: "Delta API key" },
		alphaAccessToken: {
			type: "string",
			label: "Alpha access token",
			description: "Alpha access token",
		},
	},
} as const;

const uploadProperty = (allowedFileExtensions: ReadonlyArray<string>, required = true) => ({
	label: "Export file",
	type: "string" as const,
	description: "Export file",
	format: { allowedFileExtensions, kind: "upload" as const },
	...(required ? { validation: { minLength: 1 as const, required: true as const } } : {}),
});

const registeredSource = (
	overrides: Partial<RegisteredImportSource> = {},
): RegisteredImportSource => ({
	name: "Nu",
	slug: "nu",
	configSchema,
	pluginSlug: "example",
	pluginScope: "system",
	description: "Nu export",
	workflowSlug: "nu-import",
	requiredPluginConfigKeys: [],
	pluginId: "example-plugin-id",
	configuredPluginConfigKeys: [],
	installationId: "example-installation",
	configContext: {
		configSchema,
		kind: "revision",
		ownerUserId: null,
		pluginRevisionId: "example-revision",
		pluginConfigRevisionId: "example-config-revision",
	},
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
			source: "nu",
			mode: "history",
			historyUploadToken: "history",
		});

		expect(registryImportSourceFileInputs(source, properties)).toEqual([
			{ uploadToken: "history", key: "historyUploadToken", allowedExtensions: ["csv"] },
		]);
	}),
);

it("orders upload inputs by position with unpositioned fields last", () => {
	const source = registeredSource({
		inputSchema: {
			unknownKeys: "strict",
			fields: {
				lastUploadToken: uploadProperty(["json"], false),
				firstUploadToken: { ...uploadProperty(["zip"], false), position: 1 },
				secondUploadToken: { ...uploadProperty(["csv"], false), position: 2 },
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
					when: { operator: "not_exists", path: ["secondaryUploadToken"] },
				},
				{
					kind: "validation",
					path: ["secondaryUploadToken"],
					validation: { required: true },
					when: { operator: "not_exists", path: ["primaryUploadToken"] },
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
			{ uploadToken: "primary", key: "primaryUploadToken", allowedExtensions: ["xml"] },
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
			uploadToken: "nu",
			profileName: "Kids",
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

it("names the environment keys of required keys missing from the environment config revision", () => {
	const source = registeredSource({
		configuredPluginConfigKeys: ["alphaAccessToken"],
		requiredPluginConfigKeys: ["alphaAccessToken", "deltaApiKey"],
	});
	expect(registryImportSourceMissingConfigKeys(source)).toEqual([
		"RYOT_PLUGIN_EXAMPLE_DELTA_API_KEY",
	]);
});

it("returns every required key when a private config revision is unavailable", () => {
	const source = registeredSource({
		pluginScope: "user",
		requiredPluginConfigKeys: ["alphaAccessToken", "deltaApiKey"],
		configContext: { ...registeredSource().configContext, pluginConfigRevisionId: null },
	});
	expect(registryImportSourceMissingConfigKeys(source)).toEqual([
		"alphaAccessToken",
		"deltaApiKey",
	]);
});

it("accepts a private plugin config revision without configured key checks", () => {
	const source = registeredSource({
		pluginScope: "user",
		pluginSlug: "my-example",
		pluginId: "private-plugin-id",
		installationId: "private-installation",
		requiredPluginConfigKeys: ["alphaAccessToken", "deltaApiKey"],
		configContext: {
			configSchema,
			kind: "revision",
			ownerUserId: UserId.make("owner"),
			pluginRevisionId: "private-revision",
			pluginConfigRevisionId: "private-config-revision",
		},
	});
	expect(registryImportSourceMissingConfigKeys(source)).toEqual([]);
});
