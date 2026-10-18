import { mediaPlugin } from "@ryot-app/media-plugin";
import { writePluginArchive } from "@ryot-app/plugin-archive";
import { column, document, eq, field, join, literal, rows, table } from "@ryot-app/ryotql";
import { pluginInstallationsRecipe } from "@ryot-app/ryotql-recipes/plugin-installations";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { Effect, Schema } from "effect";

import type { Client } from "~/fixtures/kernel";
import {
	collectRyotQLRecipeItems,
	createAuthenticatedClient,
	executeRyotQL,
	installPrivatePlugin,
	installPrivatePluginPackage,
	invokePrivatePluginOperation,
	listNamespaceInstallations,
	namespaceInstallation,
	pollUntil,
	PRIVATE_PLUGIN_CONFIG_KEY,
	PRIVATE_PLUGIN_SECRET_KEY,
	privateBootstrapPluginPackage,
	privatePluginPackage,
	requireRows,
	requireRyotQLText,
	requireRyotQLValue,
	testPluginPackageId,
	updatePluginState,
	updatePrivatePlugin,
	uploadPrivatePluginPackage,
	uploadTemporaryArchive,
} from "~/fixtures/kernel";
import { compilePluginPackage } from "~/fixtures/kernel/compiled-package";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const mediaPackageId = mediaPlugin.metadata.packageId;

const listPlugins = (client: Client) =>
	collectRyotQLRecipeItems(client, (after) => pluginInstallationsRecipe({ after, limit: 100 }));

describe("private plugins", () => {
	it.live(
		"retries an uninstall without targeting a private plugin reinstalled under the same package identity",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const packageId = testPluginPackageId();
				const install = () =>
					installPrivatePlugin({
						client,
						packageId,
						config: {
							[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
							[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
						},
					});
				const uninstall = (installationId: string, activationId: string) =>
					client.call((c) => c.plugins.uninstall({ params: { activationId, installationId } }));
				const first = yield* install();
				let currentActivationId = first.activationId;
				let currentInstallationId = first.installationId;
				yield* Effect.addFinalizer(() =>
					uninstall(currentInstallationId, currentActivationId).pipe(Effect.ignore),
				);
				const removed = yield* uninstall(first.installationId, first.activationId);
				const replacement = yield* install();
				currentActivationId = replacement.activationId;
				currentInstallationId = replacement.installationId;
				expect(replacement.activationId).not.toBe(first.activationId);
				expect(yield* uninstall(first.installationId, first.activationId)).toEqual(removed);
				expect(
					(yield* listPlugins(client)).find((entry) => entry.packageId === packageId)?.activationId,
				).toBe(replacement.activationId);
			}),
	);

	it.live("persists exactly one ready system installation row per shipped plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = table("plugin", "plugin");
			const installation = table("pluginInstallation", "installation");

			const readShipped = Effect.gen(function* () {
				const result = yield* executeRyotQL(
					client,
					document({
						installations: rows(installation, {
							where: eq(column(plugin, "scope"), literal("system")),
							joins: [
								join("inner", plugin, eq(column(installation, "pluginId"), column(plugin, "id"))),
							],
							fields: [
								field("health", column(installation, "health")),
								field("packageId", column(plugin, "packageId")),
								field("sortOrder", column(installation, "sortOrder")),
								field("isHidden", column(installation, "isHidden")),
							],
						}),
					}),
				);
				return requireRows(result.data.installations, "installations").items.filter((item) =>
					["ryot/fitness", "ryot/media"].includes(requireRyotQLText(item, "packageId")),
				);
			});
			const items = yield* pollUntil(
				"ready system installations for 'ryot/fitness' and 'ryot/media'",
				readShipped.pipe(
					Effect.map((candidates) => {
						const settled = candidates.filter(
							(item) =>
								requireRyotQLText(item, "health") === "ready" &&
								requireRyotQLValue(item, "sortOrder") === 0 &&
								requireRyotQLValue(item, "isHidden") === false,
						);
						return sortBy(settled.map((item) => requireRyotQLText(item, "packageId"))).join(",") ===
							"ryot/fitness,ryot/media"
							? candidates
							: null;
					}),
				),
			);

			const byPackageId = items.map((item) => requireRyotQLText(item, "packageId"));
			expect(sortBy(byPackageId)).toEqual(["ryot/fitness", "ryot/media"]);
			for (const item of items) {
				expect({
					health: requireRyotQLText(item, "health"),
					isHidden: requireRyotQLValue(item, "isHidden"),
					sortOrder: requireRyotQLValue(item, "sortOrder"),
				}).toEqual({ sortOrder: 0, health: "ready", isHidden: false });
			}
		}),
	);

	it.live("installs a private plugin for the authenticated user", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const plugin = yield* installPrivatePlugin({
				client,
				config: {
					[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
					[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
				},
			});

			expect(plugin.installation).toMatchObject({
				scope: "user",
				health: "ready",
				isHidden: false,
				version: "1.0.0",
				healthReason: null,
				packageId: plugin.manifest.metadata.packageId,
			});
			expect(plugin.installation.contentHash).toMatch(/^[0-9a-f]{64}$/);
		}),
	);

	it.live("lists the installation without source, compiled code, or secret values", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installPrivatePlugin({
				client,
				config: {
					[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
					[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
				},
			});

			const installations = yield* listPlugins(client);

			const listed = requirePresent(
				installations.find((entry) => entry.packageId === plugin.manifest.metadata.packageId),
				"Private plugin installation was not listed",
			);
			expect(listed).toMatchObject({
				scope: "user",
				health: "ready",
				contentHash: plugin.installation.contentHash,
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "alpha" },
			});
			expect(listed.configuredSecrets).toEqual([PRIVATE_PLUGIN_SECRET_KEY]);
			expect(listed.config[PRIVATE_PLUGIN_SECRET_KEY]).toBeUndefined();
			const serialized = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(listed);
			expect(serialized).not.toContain("token-alpha");
			expect(serialized).not.toContain("defineOperation");
		}),
	);

	it.live("invokes the declared operation with the caller's own config", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installPrivatePlugin({
				client,
				config: {
					[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
					[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
				},
			});

			const { result } = yield* invokePrivatePluginOperation({
				client,
				prefix: "run",
				operationSlug: plugin.operationSlug,
				packageId: plugin.manifest.metadata.packageId,
			});

			expect(result).toEqual({ label: "run:alpha" });
		}),
	);

	it.live("patches config and controls without exposing or resubmitting secrets", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installPrivatePlugin({
				client,
				config: {
					[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
					[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
				},
			});

			const patched = yield* updatePluginState(client, plugin.installationId, {
				sortOrder: 9,
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "beta" },
			});
			const persisted = requirePresent(
				(yield* listPlugins(client)).find(
					({ packageId }) => packageId === plugin.manifest.metadata.packageId,
				),
				"Patched private plugin was not found",
			);
			expect(persisted).toMatchObject({
				sortOrder: 9,
				configuredSecrets: [PRIVATE_PLUGIN_SECRET_KEY],
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "beta" },
			});
			expect(
				yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(patched),
			).not.toContain("token-alpha");
			expect(
				yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(persisted),
			).not.toContain("token-alpha");
			expect(
				(yield* invokePrivatePluginOperation({
					client,
					prefix: "run",
					operationSlug: plugin.operationSlug,
					packageId: plugin.manifest.metadata.packageId,
				})).result,
			).toEqual({ label: "run:beta" });

			yield* updatePluginState(client, plugin.installationId, { isHidden: true });
			const failure = yield* Effect.flip(
				invokePrivatePluginOperation({
					client,
					prefix: "run",
					operationSlug: plugin.operationSlug,
					packageId: plugin.manifest.metadata.packageId,
				}),
			);
			assertTaggedError(failure, "PluginNotFoundError");

			yield* updatePluginState(client, plugin.installationId, { isHidden: false });
			expect(
				(yield* invokePrivatePluginOperation({
					client,
					prefix: "run",
					operationSlug: plugin.operationSlug,
					packageId: plugin.manifest.metadata.packageId,
				})).result,
			).toEqual({ label: "run:beta" });
		}),
	);

	it.live("updates source and config without changing stable identities or omitted secrets", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const installed = yield* installPrivatePlugin({
				client,
				config: {
					[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
					[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
				},
			});
			const plugin = table("plugin", "plugin");
			const installation = table("pluginInstallation", "installation");
			const identities = () =>
				executeRyotQL(
					client,
					document({
						plugins: rows(plugin, {
							where: eq(
								column(plugin, "packageId"),
								literal(installed.manifest.metadata.packageId),
							),
							fields: [
								field("pluginId", column(plugin, "id")),
								field("installationId", column(installation, "id")),
							],
							joins: [
								join(
									"inner",
									installation,
									eq(column(installation, "pluginId"), column(plugin, "id")),
								),
							],
						}),
					}),
				);
			const before = requirePresent(
				requireRows((yield* identities()).data.plugins, "plugins").items[0],
				"Private plugin identities were not found",
			);
			const next = privatePluginPackage({
				transform: "value.toUpperCase()",
				pluginSlug: installed.pluginSlug,
				operationSlug: installed.operationSlug,
				packageId: installed.manifest.metadata.packageId,
			});
			const updated = yield* updatePrivatePlugin({
				client,
				installationId: installed.installationId,
				expectedContentHash: installed.installation.contentHash,
				payload: {
					files: next.files,
					config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "beta" },
					manifest: { ...next.manifest, metadata: { ...next.manifest.metadata, version: "2.0.0" } },
				},
			});
			const after = requirePresent(
				requireRows((yield* identities()).data.plugins, "plugins").items[0],
				"Updated private plugin identities were not found",
			);

			const persisted = requirePresent(
				(yield* listPlugins(client)).find(
					({ packageId }) => packageId === installed.manifest.metadata.packageId,
				),
				"Updated private plugin was not found",
			);
			expect(after).toEqual(before);
			expect(updated).toEqual({
				id: requireRyotQLText(after, "installationId"),
				pluginId: requireRyotQLText(after, "pluginId"),
			});
			expect(persisted).toMatchObject({
				version: "2.0.0",
				configuredSecrets: [PRIVATE_PLUGIN_SECRET_KEY],
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "beta" },
			});
			expect(persisted.contentHash).not.toBe(installed.installation.contentHash);
			const stale = yield* Effect.flip(
				invokePrivatePluginOperation({
					client,
					prefix: "run",
					operationSlug: installed.operationSlug,
					contentHash: installed.installation.contentHash,
					packageId: installed.manifest.metadata.packageId,
				}),
			);
			assertTaggedError(stale, "PluginConflictError");
			expect(stale.reason.code).toBe("source-revision-stale");
			expect(
				(yield* invokePrivatePluginOperation({
					client,
					prefix: "run",
					contentHash: persisted.contentHash,
					operationSlug: installed.operationSlug,
					packageId: installed.manifest.metadata.packageId,
				})).result,
			).toEqual({ label: "run:BETA" });
		}),
	);

	it.live("rejects required unsets, system config, and another user's patch", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			const plugin = yield* installPrivatePlugin({
				client: owner.client,
				config: {
					[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
					[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
				},
			});

			const unset = yield* Effect.flip(
				updatePluginState(owner.client, plugin.installationId, {
					unsetConfigKeys: [PRIVATE_PLUGIN_CONFIG_KEY],
				}),
			);
			assertTaggedError(unset, "PluginRequestError");
			expect(unset.reason.code).toBe("validation-failed");

			const foreign = yield* Effect.flip(
				updatePluginState(outsider.client, plugin.installationId, { sortOrder: 4 }),
			);
			assertTaggedError(foreign, "PluginNotFoundError");

			const media = requirePresent(
				(yield* listNamespaceInstallations(owner.client)).find(
					({ scope, packageId }) => packageId === mediaPackageId && scope === "system",
				),
				"Media installation missing",
			);
			const system = yield* Effect.flip(updatePluginState(owner.client, media.id, { config: {} }));
			assertTaggedError(system, "PluginConflictError");
			expect(system.reason).toEqual({ code: "system-plugin", pluginId: media.pluginId });
		}),
	);

	it.live("isolates two users installing different packages under the same package identity", () =>
		Effect.gen(function* () {
			const first = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const sharedPackageId = testPluginPackageId();

			const firstPlugin = yield* installPrivatePlugin({
				client: first.client,
				packageId: sharedPackageId,
				transform: "value.toUpperCase()",
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "alpha", [PRIVATE_PLUGIN_SECRET_KEY]: "token-a" },
			});
			const secondPlugin = yield* installPrivatePlugin({
				client: second.client,
				packageId: sharedPackageId,
				transform: "value + '-suffix'",
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "beta", [PRIVATE_PLUGIN_SECRET_KEY]: "token-b" },
			});

			expect(firstPlugin.installation.contentHash).not.toBe(secondPlugin.installation.contentHash);

			const firstResult = yield* invokePrivatePluginOperation({
				prefix: "run",
				client: first.client,
				operationSlug: firstPlugin.operationSlug,
				packageId: firstPlugin.manifest.metadata.packageId,
			});
			const secondResult = yield* invokePrivatePluginOperation({
				prefix: "run",
				client: second.client,
				operationSlug: secondPlugin.operationSlug,
				packageId: secondPlugin.manifest.metadata.packageId,
			});

			expect(firstResult.result).toEqual({ label: "run:ALPHA" });
			expect(secondResult.result).toEqual({ label: "run:beta-suffix" });
		}),
	);

	it.live("hides another user's private plugin from listing and invocation", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			const plugin = yield* installPrivatePlugin({
				client: owner.client,
				config: {
					[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
					[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
				},
			});

			const failure = yield* Effect.flip(
				invokePrivatePluginOperation({
					prefix: "run",
					client: outsider.client,
					operationSlug: plugin.operationSlug,
					packageId: plugin.manifest.metadata.packageId,
				}),
			);
			assertTaggedError(failure, "PluginNotFoundError");
			expect(failure.reason).toEqual({
				code: "operation-not-found",
				operationSlug: plugin.operationSlug,
				packageId: plugin.manifest.metadata.packageId,
			});

			const installations = yield* listPlugins(outsider.client);
			expect(installations.map((entry) => entry.packageId)).not.toContain(
				plugin.manifest.metadata.packageId,
			);
		}),
	);

	it.live("rejects the exact package identity of an active system plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const failure = yield* Effect.flip(
				installPrivatePlugin({
					client,
					config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "alpha" },
					packageId: requirePresent(
						(yield* listNamespaceInstallations(client)).find(
							({ scope, packageId }) => packageId === mediaPackageId && scope === "system",
						),
						"Media installation missing",
					).packageId,
				}),
			);

			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason.code).toBe("reserved-system-identity");
		}),
	);

	it.live("rejects a corrupt private plugin archive", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const validPackage = yield* compilePluginPackage(privatePluginPackage());
			const validArchive = writePluginArchive(validPackage);
			const uploadToken = yield* uploadTemporaryArchive(client, validArchive.slice(0, -1), {
				fileName: "corrupt-plugin.zip",
			});

			const failure = yield* Effect.flip(
				client.call((c) => c.plugins.install({ payload: { config: {}, uploadToken } })),
			);

			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason).toEqual({ issue: "malformed-zip", code: "package-archive-invalid" });
		}),
	);

	it.live("rejects a spent private plugin upload token", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = privatePluginPackage();
			const uploadToken = yield* uploadPrivatePluginPackage(client, plugin);
			const payload = { uploadToken, config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "alpha" } };

			yield* client.call((c) => c.plugins.install({ payload }));
			const failure = yield* Effect.flip(client.call((c) => c.plugins.install({ payload })));

			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason).toEqual({ code: "upload-unavailable" });
		}),
	);

	it.live("runs a private manifest's local user bootstrap", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const installed = yield* installPrivatePluginPackage({
				client,
				config: {},
				pluginPackage: privateBootstrapPluginPackage(),
			});
			expect((yield* namespaceInstallation(client, installed.pluginId)).health).toBe("ready");
		}),
	);

	it.live("refuses to uninstall another user's plugin or a system plugin", () =>
		Effect.gen(function* () {
			const owner = yield* createAuthenticatedClient();
			const outsider = yield* createAuthenticatedClient();
			const plugin = yield* installPrivatePlugin({
				client: owner.client,
				config: {
					[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
					[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
				},
			});

			const foreign = yield* Effect.flip(
				outsider.client.call((c) =>
					c.plugins.uninstall({
						params: { activationId: plugin.activationId, installationId: plugin.installationId },
					}),
				),
			);
			assertTaggedError(foreign, "PluginNotFoundError");
			expect(foreign.reason).toEqual({
				code: "installation-not-found",
				installationId: plugin.installationId,
			});

			const media = requirePresent(
				(yield* listNamespaceInstallations(owner.client)).find(
					({ scope, packageId }) => packageId === mediaPackageId && scope === "system",
				),
				"Media installation missing",
			);
			const system = yield* Effect.flip(
				owner.client.call((c) =>
					c.plugins.uninstall({
						params: { installationId: media.id, activationId: media.activationId },
					}),
				),
			);
			assertTaggedError(system, "PluginConflictError");
			expect(system.reason).toEqual({ code: "system-plugin", pluginId: media.pluginId });
		}),
	);

	it.live("uninstalls an unreferenced private installation", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = yield* installPrivatePlugin({
				client,
				config: {
					[PRIVATE_PLUGIN_CONFIG_KEY]: "alpha",
					[PRIVATE_PLUGIN_SECRET_KEY]: "token-alpha",
				},
			});

			yield* client.call((c) =>
				c.plugins.uninstall({
					params: { activationId: plugin.activationId, installationId: plugin.installationId },
				}),
			);
			expect((yield* listPlugins(client)).map(({ packageId }) => packageId)).not.toContain(
				plugin.manifest.metadata.packageId,
			);
			const failure = yield* Effect.flip(
				invokePrivatePluginOperation({
					client,
					prefix: "run",
					operationSlug: plugin.operationSlug,
					packageId: plugin.manifest.metadata.packageId,
				}),
			);
			assertTaggedError(failure, "PluginNotFoundError");
		}),
	);
});
