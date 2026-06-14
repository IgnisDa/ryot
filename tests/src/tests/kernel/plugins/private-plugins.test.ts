import { PluginSlug } from "@ryot/contract/schema/brands";
import { column, document, eq, field, join, literal, rows, table } from "@ryot/ryotql";
import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";

import {
	createAuthenticatedClient,
	executeRyotQL,
	installPrivateBootstrapPlugin,
	installPrivatePlugin,
	invokePrivatePluginOperation,
	PRIVATE_PLUGIN_CONFIG_KEY,
	PRIVATE_PLUGIN_SECRET_KEY,
	privatePluginPackage,
	requireRows,
	requireRyotQLText,
	requireRyotQLValue,
	updatePluginState,
	updatePrivatePlugin,
} from "~/fixtures";
import { assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

const mediaSlug = PluginSlug.make("media");

describe("private plugins", () => {
	it.live("persists exactly one ready system installation row per shipped plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = table("plugin", "plugin");
			const installation = table("pluginInstallation", "installation");

			const result = yield* executeRyotQL(
				client,
				document({
					installations: rows(installation, {
						joins: [
							join("inner", plugin, eq(column(installation, "pluginId"), column(plugin, "id"))),
						],
						fields: [
							field("health", column(installation, "health")),
							field("pluginSlug", column(plugin, "slug")),
							field("sortOrder", column(installation, "sortOrder")),
							field("isDisabled", column(installation, "isDisabled")),
						],
						where: eq(column(plugin, "scope"), literal("system")),
					}),
				}),
			);

			const items = requireRows(result.data.installations, "installations").items;
			const bySlug = items.map((item) => requireRyotQLText(item, "pluginSlug"));
			expect(sortBy(bySlug)).toEqual(["fitness", "media"]);
			for (const item of items) {
				expect({
					health: requireRyotQLText(item, "health"),
					sortOrder: requireRyotQLValue(item, "sortOrder"),
					isDisabled: requireRyotQLValue(item, "isDisabled"),
				}).toEqual({ health: "ready", sortOrder: 0, isDisabled: false });
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
				version: "1.0.0",
				isDisabled: false,
				healthReason: null,
				slug: plugin.pluginSlug,
			});
			expect(plugin.installation.sourceHash).toMatch(/^[0-9a-f]{64}$/);
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

			const installations = yield* client.call((c) => c.plugins.list());

			const listed = requirePresent(
				installations.find((entry) => entry.slug === plugin.pluginSlug),
				"Private plugin installation was not listed",
			);
			expect(listed).toMatchObject({
				scope: "user",
				health: "ready",
				sourceHash: plugin.installation.sourceHash,
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "alpha" },
			});
			expect(listed.configuredSecrets).toEqual([PRIVATE_PLUGIN_SECRET_KEY]);
			expect(listed.config[PRIVATE_PLUGIN_SECRET_KEY]).toBeUndefined();
			expect(JSON.stringify(listed)).not.toContain("token-alpha");
			expect(JSON.stringify(listed)).not.toContain("defineOperation");
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
				pluginSlug: plugin.pluginSlug,
				operationSlug: plugin.operationSlug,
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

			const patched = yield* updatePluginState(client, plugin.pluginSlug, {
				sortOrder: 9,
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "beta" },
			});
			expect(patched).toMatchObject({
				sortOrder: 9,
				configuredSecrets: [PRIVATE_PLUGIN_SECRET_KEY],
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "beta" },
			});
			expect(JSON.stringify(patched)).not.toContain("token-alpha");
			expect(
				(yield* invokePrivatePluginOperation({
					client,
					prefix: "run",
					pluginSlug: plugin.pluginSlug,
					operationSlug: plugin.operationSlug,
				})).result,
			).toEqual({ label: "run:beta" });

			yield* updatePluginState(client, plugin.pluginSlug, { isDisabled: true });
			const failure = yield* Effect.flip(
				invokePrivatePluginOperation({
					client,
					prefix: "run",
					pluginSlug: plugin.pluginSlug,
					operationSlug: plugin.operationSlug,
				}),
			);
			assertTaggedError(failure, "PluginNotFoundError");

			yield* updatePluginState(client, plugin.pluginSlug, { isDisabled: false });
			expect(
				(yield* invokePrivatePluginOperation({
					client,
					prefix: "run",
					pluginSlug: plugin.pluginSlug,
					operationSlug: plugin.operationSlug,
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
							where: eq(column(plugin, "slug"), literal(installed.pluginSlug)),
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
			});
			const updated = yield* updatePrivatePlugin({
				client,
				pluginSlug: installed.pluginSlug,
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

			expect(after).toEqual(before);
			expect(updated).toMatchObject({
				version: "2.0.0",
				configuredSecrets: [PRIVATE_PLUGIN_SECRET_KEY],
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "beta" },
			});
			expect(updated.sourceHash).not.toBe(installed.installation.sourceHash);
			expect(
				(yield* invokePrivatePluginOperation({
					client,
					prefix: "run",
					pluginSlug: installed.pluginSlug,
					operationSlug: installed.operationSlug,
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
				updatePluginState(owner.client, plugin.pluginSlug, {
					unsetConfigKeys: [PRIVATE_PLUGIN_CONFIG_KEY],
				}),
			);
			assertTaggedError(unset, "PluginRequestError");
			expect(unset.reason.code).toBe("validation-failed");

			const foreign = yield* Effect.flip(
				updatePluginState(outsider.client, plugin.pluginSlug, { sortOrder: 4 }),
			);
			assertTaggedError(foreign, "PluginNotFoundError");

			const system = yield* Effect.flip(updatePluginState(owner.client, mediaSlug, { config: {} }));
			assertTaggedError(system, "PluginConflictError");
			expect(system.reason).toEqual({ code: "system-plugin", pluginSlug: mediaSlug });
		}),
	);

	it.live("isolates two users installing different packages under the same slug", () =>
		Effect.gen(function* () {
			const first = yield* createAuthenticatedClient();
			const second = yield* createAuthenticatedClient();
			const sharedSlug = `e2e-private-shared-${crypto.randomUUID()}`;

			const firstPlugin = yield* installPrivatePlugin({
				client: first.client,
				pluginSlug: sharedSlug,
				transform: "value.toUpperCase()",
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "alpha", [PRIVATE_PLUGIN_SECRET_KEY]: "token-a" },
			});
			const secondPlugin = yield* installPrivatePlugin({
				client: second.client,
				pluginSlug: sharedSlug,
				transform: "value + '-suffix'",
				config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "beta", [PRIVATE_PLUGIN_SECRET_KEY]: "token-b" },
			});

			expect(firstPlugin.installation.sourceHash).not.toBe(secondPlugin.installation.sourceHash);

			const firstResult = yield* invokePrivatePluginOperation({
				prefix: "run",
				client: first.client,
				pluginSlug: firstPlugin.pluginSlug,
				operationSlug: firstPlugin.operationSlug,
			});
			const secondResult = yield* invokePrivatePluginOperation({
				prefix: "run",
				client: second.client,
				pluginSlug: secondPlugin.pluginSlug,
				operationSlug: secondPlugin.operationSlug,
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
					pluginSlug: plugin.pluginSlug,
					operationSlug: plugin.operationSlug,
				}),
			);
			assertTaggedError(failure, "PluginNotFoundError");
			expect(failure.reason).toEqual({
				code: "operation-not-found",
				pluginSlug: plugin.pluginSlug,
				operationSlug: plugin.operationSlug,
			});

			const installations = yield* outsider.client.call((c) => c.plugins.list());
			expect(installations.map((entry) => entry.slug)).not.toContain(plugin.pluginSlug);
		}),
	);

	it.live("rejects a slug that names an active system plugin", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const failure = yield* Effect.flip(
				installPrivatePlugin({
					client,
					pluginSlug: mediaSlug,
					config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "alpha" },
				}),
			);

			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason).toEqual({ code: "slug-reserved", pluginSlug: mediaSlug });
		}),
	);

	it.live("rejects a private manifest that declares an instance boot entry", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const plugin = privatePluginPackage();
			const scriptSlug = requirePresent(
				plugin.manifest.scripts[0],
				"Private plugin fixture has no script",
			).slug;

			const failure = yield* Effect.flip(
				client.call((c) =>
					c.plugins.install({
						payload: {
							files: plugin.files,
							config: { [PRIVATE_PLUGIN_CONFIG_KEY]: "alpha" },
							manifest: {
								...plugin.manifest,
								boot: [{ scriptSlug, slug: "startup", description: "Unsupported private surface" }],
							},
						},
					}),
				),
			);

			assertTaggedError(failure, "PluginRequestError");
			expect(failure.reason).toEqual({ surfaces: ["boot"], code: "unsupported-manifest-surface" });
		}),
	);

	it.live("runs a declared user bootstrap entry before the installation becomes ready", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const plugin = yield* installPrivateBootstrapPlugin({ client });

			expect(plugin.installation).toMatchObject({
				scope: "user",
				health: "ready",
				healthReason: null,
				slug: plugin.pluginSlug,
			});
			const invoked = yield* client.call((c) =>
				c.plugins.invoke({
					payload: { payload: { titles: ["seeded"] } },
					params: { pluginSlug: plugin.pluginSlug, operationSlug: plugin.operationSlug },
				}),
			);
			expect(invoked.result).toEqual({ results: ["SEEDED"] });
		}),
	);

	it.live("fails the installation safely when a user bootstrap entry throws", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();

			const plugin = yield* installPrivateBootstrapPlugin({
				client,
				failureMessage: "bootstrap exploded",
			});

			expect(plugin.installation.health).toBe("failed");
			const healthReason = requirePresent(
				plugin.installation.healthReason,
				"Failed private installation has no diagnostic",
			);
			expect(healthReason).toContain(plugin.bootstrapSlug);
			expect(healthReason).not.toContain("bootstrap exploded");
			expect(healthReason).not.toContain("defineScript");
			expect(healthReason).not.toContain("at ");

			const failure = yield* Effect.flip(
				invokePrivatePluginOperation({
					client,
					prefix: "run",
					pluginSlug: plugin.pluginSlug,
					operationSlug: plugin.operationSlug,
				}),
			);
			assertTaggedError(failure, "PluginNotFoundError");
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
					c.plugins.uninstall({ params: { pluginSlug: plugin.pluginSlug } }),
				),
			);
			assertTaggedError(foreign, "PluginNotFoundError");
			expect(foreign.reason).toEqual({ code: "plugin-not-found", pluginSlug: plugin.pluginSlug });

			const system = yield* Effect.flip(
				owner.client.call((c) => c.plugins.uninstall({ params: { pluginSlug: mediaSlug } })),
			);
			assertTaggedError(system, "PluginConflictError");
			expect(system.reason).toEqual({ code: "system-plugin", pluginSlug: mediaSlug });
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

			const removed = yield* client.call((c) =>
				c.plugins.uninstall({ params: { pluginSlug: plugin.pluginSlug } }),
			);
			expect(removed.slug).toBe(plugin.pluginSlug);
			expect((yield* client.call((c) => c.plugins.list())).map(({ slug }) => slug)).not.toContain(
				plugin.pluginSlug,
			);
			const failure = yield* Effect.flip(
				invokePrivatePluginOperation({
					client,
					prefix: "run",
					pluginSlug: plugin.pluginSlug,
					operationSlug: plugin.operationSlug,
				}),
			);
			assertTaggedError(failure, "PluginNotFoundError");
		}),
	);
});
