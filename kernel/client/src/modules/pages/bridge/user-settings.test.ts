import { describe, expect, it } from "@effect/vitest";
import type { PreparedClientPage } from "@ryot-app/contract/modules/pages/schemas";
import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { PluginId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import { pluginInstallationUserSettingsRecipe } from "@ryot-app/ryotql-recipes/plugin-user-settings";
import { Effect } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { pluginUserSettingsOutcome } from "#/modules/pages/bridge/user-settings";

const scope: ApiScope = { userId: "user-1", serverUrl: decodeServerOrigin("https://ryot.example") };
const otherScope: ApiScope = { ...scope, userId: "user-2" };
const pluginA = PluginId.make("plugin-a");
const pluginB = PluginId.make("plugin-b");
const pluginC = PluginId.make("plugin-c");

const contributor = (pluginId: PluginId) => ({
	pluginId,
	kind: "plugin" as const,
	contentHash: `${pluginId}-source`,
	revisionId: `${pluginId}-revision`,
	installationId: `${pluginId}-installation`,
	packageId: PluginPackageId.make(`test/${pluginId}`),
});

const contributors: PreparedClientPage["identity"]["contributors"] = [
	contributor(pluginA),
	contributor(pluginB),
	{ name: "table", kind: "kernel-renderer", sourceHash: "source-hash" },
];

const settingsSchema = {
	unknownKeys: "strict" as const,
	fields: {
		theme: { label: "Theme", description: "Theme", type: "string" as const },
		limit: { label: "Limit", defaultValue: 5, description: "Limit", type: "integer" as const },
		enabled: {
			label: "Enabled",
			defaultValue: false,
			description: "Enabled",
			type: "boolean" as const,
		},
	},
};

const installedRows: Partial<Record<string, Readonly<Record<string, unknown>>>> = {
	[pluginA]: { settingsSchema, id: "installation-a", settings: { enabled: true } },
	[pluginC]: { settingsSchema, id: "installation-c", settings: { limit: 9, theme: "dark" } },
};

const rowsFor = (document: RyotQLDocument) => {
	const row = [pluginA, pluginB, pluginC]
		.filter(
			(pluginId) =>
				JSON.stringify(pluginInstallationUserSettingsRecipe({ pluginId }).document) ===
				JSON.stringify(document),
		)
		.flatMap((pluginId) =>
			installedRows[pluginId] === undefined ? [] : [installedRows[pluginId]],
		);
	return {
		data: {
			installation: {
				items: row,
				type: "rows" as const,
				pageInfo: { limit: 2, hasMore: false, nextCursor: null },
			},
		},
	};
};

const makeApi = (options: { readonly fail?: boolean; readonly onExecute?: () => void } = {}) => {
	const executed: Array<{ readonly scope: ApiScope; readonly document: RyotQLDocument }> = [];
	return {
		executed,
		api: {
			execute: (requestScope: ApiScope, request: { readonly payload: RyotQLDocument }) =>
				Effect.suspend(() => {
					executed.push({ scope: requestScope, document: request.payload });
					options.onExecute?.();
					return options.fail
						? Effect.fail(new AuthenticatedApiError({ cause: "offline" }))
						: Effect.succeed(rowsFor(request.payload));
				}),
		},
	};
};

const read = (
	api: ReturnType<typeof makeApi>["api"],
	pluginId: PluginId,
	currentScope: () => ApiScope | undefined = () => scope,
) => pluginUserSettingsOutcome({ api, scope, contributors, currentScope, request: { pluginId } });

describe("plugin user settings bridge read", () => {
	it.effect("reads contributing plugins with defaults and refuses installed non-contributors", () =>
		Effect.gen(function* () {
			const { api, executed } = makeApi();

			expect(yield* read(api, pluginA)).toEqual({
				outcome: "success",
				settings: { limit: 5, enabled: true },
			});
			expect(yield* read(api, pluginB)).toEqual({ settings: {}, outcome: "success" });
			expect(yield* read(api, pluginC)).toEqual({ outcome: "failure", reason: "invalid-request" });
			expect(executed).toEqual([
				{ scope, document: pluginInstallationUserSettingsRecipe({ pluginId: pluginA }).document },
				{ scope, document: pluginInstallationUserSettingsRecipe({ pluginId: pluginB }).document },
			]);
		}),
	);

	it.effect("returns an empty record for a contributor whose plugin declares no settings", () =>
		Effect.gen(function* () {
			const api = {
				execute: () =>
					Effect.succeed({
						data: {
							installation: {
								type: "rows" as const,
								pageInfo: { limit: 2, hasMore: false, nextCursor: null },
								items: [{ settings: {}, settingsSchema: null, id: "installation-a" }],
							},
						},
					}),
			};
			expect(yield* read(api, pluginA)).toEqual({ settings: {}, outcome: "success" });
		}),
	);

	it.effect("refuses requests after a scope switch, including one during the read", () =>
		Effect.gen(function* () {
			let current: ApiScope | undefined = otherScope;
			const switched = makeApi();
			expect(yield* read(switched.api, pluginA, () => current)).toEqual({
				outcome: "failure",
				reason: "invalid-request",
			});
			current = undefined;
			expect(yield* read(switched.api, pluginA, () => current)).toEqual({
				outcome: "failure",
				reason: "invalid-request",
			});
			expect(switched.executed).toEqual([]);

			current = scope;
			const during = makeApi({
				onExecute: () => {
					current = otherScope;
				},
			});
			expect(yield* read(during.api, pluginA, () => current)).toEqual({
				outcome: "failure",
				reason: "invalid-request",
			});
			expect(during.executed).toHaveLength(1);
		}),
	);

	it.effect("reports transport failures", () =>
		Effect.gen(function* () {
			expect(yield* read(makeApi({ fail: true }).api, pluginA)).toEqual({
				outcome: "failure",
				reason: "transport",
			});
		}),
	);
});
