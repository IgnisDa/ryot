import type { DefinitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { Result } from "effect";
import { assert, expect, it } from "vitest";

import { importSourcesRecipe } from "./import-sources";
import { integrationProvidersRecipe } from "./integration-providers";
import { rowsResult } from "./test-utils";

const owner = { kind: "plugin", pluginId: PluginId.make("plugin-owner") } satisfies DefinitionOwner;
const packageId = PluginPackageId.make("ryot/media");

const script = (slug: string, keys: ReadonlyArray<string> = []) => ({
	slug,
	capabilities: [],
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
					packageId,
					id: "source",
					slug: "source",
					name: "Source",
					exportHelp: null,
					isStartable: true,
					pluginScope: "user",
					description: "Source",
					workflowSlug: "import",
					pluginId: owner.pluginId,
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
				selected: { settings: { mode: undefined }, reference: { owner, slug: "source" } },
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
				selected: { settings: { mode: "api" }, reference: { owner, slug: "source" } },
			}).decode({ data }),
		).items[0]?.readiness.blockReasons,
	).toEqual([{ key: "token", code: "configuration-required" }]);
	const first = data.sources.items[0];
	assert(first);
	const foreignPluginId = PluginId.make("foreign-owner");
	const decoded = Result.getOrThrow(
		importSourcesRecipe({
			limit: 2,
			selected: { settings: { mode: "api" }, reference: { owner, slug: "source" } },
		}).decode({
			data: {
				sources: rowsResult(
					[
						first,
						{ ...first, id: "foreign-source", packageId: "test/other", pluginId: foreignPluginId },
					],
					{ limit: 2, hasMore: false, nextCursor: null },
				),
			},
		}),
	);
	expect(
		decoded.items.map(({ id, readiness }) => ({
			id,
			ready: readiness.ready,
			blockReasons: readiness.blockReasons,
		})),
	).toEqual([
		{
			id: "source",
			ready: false,
			blockReasons: [{ key: "token", code: "configuration-required" }],
		},
		{ ready: true, blockReasons: [], id: "foreign-source" },
	]);
	expect(decoded.items[1]?.reference).toEqual({
		slug: "source",
		owner: { kind: "plugin", pluginId: foreignPluginId },
	});
});

it("matches selected OAuth connections to their settings field, provider and integration binding", () => {
	const data = {
		providers: rowsResult(
			[
				{
					packageId,
					plan: null,
					lot: "yank",
					id: "provider",
					hasScript: true,
					slug: "provider",
					name: "Provider",
					scriptSlug: "root",
					pluginScope: "user",
					requiresProKey: false,
					description: "Provider",
					pluginId: owner.pluginId,
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
				selected: { settings: { account: "unbound" }, reference: { owner, slug: "provider" } },
			}).decode({ data }),
		).items[0]?.readiness.ready,
	).toBe(true);
	expect(
		Result.getOrThrow(
			integrationProvidersRecipe({
				limit: 1,
				selected: { settings: { account: "bound" }, reference: { owner, slug: "provider" } },
			}).decode({ data }),
		).items[0]?.readiness.blockReasons,
	).toEqual([{ key: "account", code: "connection-required" }]);
	expect(
		Result.getOrThrow(
			integrationProvidersRecipe({
				limit: 1,
				selected: {
					integrationId: "integration",
					settings: { account: "bound" },
					reference: { owner, slug: "provider" },
				},
			}).decode({ data }),
		).items[0]?.readiness.ready,
	).toBe(true);
	expect(
		Result.getOrThrow(
			integrationProvidersRecipe({
				limit: 1,
				selected: {
					reference: { owner, slug: "provider" },
					settings: { account: "wrong-provider" },
				},
			}).decode({ data }),
		).items[0]?.readiness.ready,
	).toBe(false);
});

it("uses the provider plan to select settings-dependent executable requirements", () => {
	const data = {
		providers: rowsResult(
			[
				{
					packageId,
					lot: "sink",
					hasScript: true,
					id: "conditional",
					scriptSlug: "root",
					slug: "conditional",
					name: "Conditional",
					pluginScope: "user",
					requiresProKey: false,
					pluginId: owner.pluginId,
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
				selected: { settings: {}, reference: { owner, slug: "conditional" } },
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
				selected: { settings: { remote: true }, reference: { owner, slug: "conditional" } },
			}).decode({ data }),
		).items[0]?.readiness,
	).toEqual({
		ready: false,
		plan: { operation: "root", selection: { collector: "remote" } },
		blockReasons: [{ key: "token", code: "configuration-required" }],
	});
});
