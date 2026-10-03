import { Result } from "effect";
import { expect, it } from "vitest";

import { importSourcesRecipe } from "./import-sources";
import { integrationProvidersRecipe } from "./integration-providers";
import { rowsResult } from "./test-utils";

const script = (slug: string, keys: ReadonlyArray<string> = []) => ({
	slug,
	capabilities: [],
	runtimeImports: [],
	oauthConnectionFields: [],
	executableDependencies: [],
	optionalPluginConfigKeys: [],
	requiredPluginConfigKeys: keys,
});

it("uses the same catalog snapshot for unconditional and settings-selected import readiness", () => {
	const data = {
		sources: rowsResult(
			[
				{
					id: "source",
					slug: "source",
					name: "Source",
					exportHelp: null,
					isStartable: true,
					pluginScope: "user",
					pluginSlug: "plugin",
					description: "Source",
					workflowSlug: "import",
					missingPluginConfigKeys: [],
					requiredPluginConfigKeys: [],
					installationId: "installation",
					plan: {
						selections: { collector: { field: "mode", cases: { api: "api", export: "export" } } },
					},
					inputSchema: {
						unknownKeys: "strict",
						fields: {
							mode: {
								type: "enum",
								label: "Mode",
								description: "Mode",
								defaultValue: "export",
								choices: { kind: "static", values: [{ value: "api" }, { value: "export" }] },
							},
						},
					},
					readinessMetadata: {
						oauthProviders: [],
						availableConfigKeys: [],
						workflows: [{ slug: "import", scriptSlug: "root" }],
						scripts: [
							{
								...script("root"),
								executableDependencies: [
									{
										slug: "api",
										kind: "script",
										selection: { key: "api", id: "collector", stage: "settings" },
									},
									{
										kind: "script",
										slug: "export",
										selection: { key: "export", id: "collector", stage: "settings" },
									},
								],
							},
							script("api", ["token"]),
							script("export"),
						],
					},
				},
			],
			{ limit: 1, hasMore: false, nextCursor: null },
		),
	};
	expect(
		Result.getOrThrow(importSourcesRecipe({ limit: 1 }).decode({ data })).items[0]?.readiness,
	).toEqual({ plan: null, ready: true, blockReasons: [] });
	expect(
		Result.getOrThrow(
			importSourcesRecipe({
				limit: 1,
				selected: { slug: "source", settings: { mode: undefined } },
			}).decode({ data }),
		).items[0]?.readiness,
	).toEqual({
		ready: true,
		blockReasons: [],
		plan: { operation: "import", selection: { collector: "export" } },
	});
	expect(
		Result.getOrThrow(
			importSourcesRecipe({
				limit: 1,
				selected: { slug: "source", settings: { mode: "api" } },
			}).decode({ data }),
		).items[0]?.readiness.blockReasons,
	).toEqual([{ key: "token", code: "configuration-required" }]);
});

it("matches selected OAuth connections to their settings field, provider and integration binding", () => {
	const data = {
		providers: rowsResult(
			[
				{
					plan: null,
					lot: "yank",
					id: "provider",
					hasScript: true,
					slug: "provider",
					name: "Provider",
					scriptSlug: "root",
					pluginScope: "user",
					pluginSlug: "plugin",
					requiresProKey: false,
					description: "Provider",
					supportsOwnershipSync: false,
					installationId: "installation",
					settingsSchema: {
						fields: {
							account: {
								type: "string",
								label: "Account",
								description: "Account",
								validation: { required: true },
								format: { provider: "remote", kind: "oauth-connection" },
							},
						},
					},
					readinessMetadata: {
						workflows: [],
						availableConfigKeys: ["id", "secret"],
						scripts: [{ ...script("root"), oauthConnectionFields: ["account"] }],
						oauthProviders: [
							{ slug: "remote", clientIdConfigKey: "id", clientSecretConfigKey: "secret" },
						],
					},
					readinessConnections: [
						{ id: "unbound", field: "account", provider: "remote", integrationId: null },
						{ id: "bound", field: "account", provider: "remote", integrationId: "integration" },
						{ field: "account", provider: "other", integrationId: null, id: "wrong-provider" },
					],
				},
			],
			{ limit: 1, hasMore: false, nextCursor: null },
		),
	};
	expect(
		Result.getOrThrow(integrationProvidersRecipe({ limit: 1 }).decode({ data })).items[0]?.readiness
			.ready,
	).toBe(true);
	expect(
		Result.getOrThrow(
			integrationProvidersRecipe({
				limit: 1,
				selected: { slug: "provider", settings: { account: "unbound" } },
			}).decode({ data }),
		).items[0]?.readiness.ready,
	).toBe(true);
	expect(
		Result.getOrThrow(
			integrationProvidersRecipe({
				limit: 1,
				selected: { slug: "provider", settings: { account: "bound" } },
			}).decode({ data }),
		).items[0]?.readiness.blockReasons,
	).toEqual([{ key: "account", code: "connection-required" }]);
	expect(
		Result.getOrThrow(
			integrationProvidersRecipe({
				limit: 1,
				selected: {
					slug: "provider",
					integrationId: "integration",
					settings: { account: "bound" },
				},
			}).decode({ data }),
		).items[0]?.readiness.ready,
	).toBe(true);
	expect(
		Result.getOrThrow(
			integrationProvidersRecipe({
				limit: 1,
				selected: { slug: "provider", settings: { account: "wrong-provider" } },
			}).decode({ data }),
		).items[0]?.readiness.ready,
	).toBe(false);
});

it("uses the provider plan to select settings-dependent executable requirements", () => {
	const data = {
		providers: rowsResult(
			[
				{
					lot: "sink",
					hasScript: true,
					id: "conditional",
					scriptSlug: "root",
					slug: "conditional",
					name: "Conditional",
					pluginScope: "user",
					pluginSlug: "plugin",
					requiresProKey: false,
					readinessConnections: [],
					supportsOwnershipSync: false,
					installationId: "installation",
					description: "Conditional provider",
					plan: {
						selections: {
							collector: { field: "remote", cases: { true: "remote", false: "local" } },
						},
					},
					settingsSchema: {
						fields: {
							remote: {
								type: "boolean",
								label: "Remote",
								defaultValue: false,
								description: "Use remote service",
							},
						},
					},
					readinessMetadata: {
						workflows: [],
						oauthProviders: [],
						availableConfigKeys: [],
						scripts: [
							{
								...script("root"),
								executableDependencies: [
									{
										kind: "script",
										slug: "remote",
										selection: { key: "remote", id: "collector", stage: "settings" },
									},
									{
										slug: "local",
										kind: "script",
										selection: { key: "local", id: "collector", stage: "settings" },
									},
								],
							},
							script("remote", ["token"]),
							script("local"),
						],
					},
				},
			],
			{ limit: 1, hasMore: false, nextCursor: null },
		),
	};
	expect(
		Result.getOrThrow(
			integrationProvidersRecipe({
				limit: 1,
				selected: { settings: {}, slug: "conditional" },
			}).decode({ data }),
		).items[0]?.readiness,
	).toEqual({
		ready: true,
		blockReasons: [],
		plan: { operation: "root", selection: { collector: "local" } },
	});
	expect(
		Result.getOrThrow(
			integrationProvidersRecipe({
				limit: 1,
				selected: { slug: "conditional", settings: { remote: true } },
			}).decode({ data }),
		).items[0]?.readiness,
	).toEqual({
		ready: false,
		plan: { operation: "root", selection: { collector: "remote" } },
		blockReasons: [{ key: "token", code: "configuration-required" }],
	});
});
