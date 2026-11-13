import { expect } from "bun:test";

import { PluginConflictError } from "@ryot-app/contract/modules/plugins/schemas";
import { createRyotClient } from "@ryot-app/plugin-client-sdk";
import { createTestRyotAdapter } from "@ryot-app/plugin-client-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { ServerOrigin } from "#/api/origin";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import { PluginManagementService } from "#/modules/plugins/management/service";
import { managedInstallation } from "#/modules/plugins/management/service.test-fixtures";

class Commands extends Context.Service<
	Commands,
	{ readonly calls: Effect.Effect<readonly unknown[]> }
>()("@ryot-app/kernel-client/modules/plugins/management/service.test/Commands") {}

const dependencies = Layer.effectContext(
	Effect.gen(function* () {
		const calls = yield* Ref.make<readonly unknown[]>([]);
		const installation = managedInstallation();
		const record = (method: string, request: unknown) =>
			Ref.update(calls, (all) => [...all, { method, request }]).pipe(
				Effect.as({ id: installation.installationId, pluginId: installation.pluginId }),
			);
		return Context.make(Commands, { calls: Ref.get(calls) }).pipe(
			Context.add(PluginInstallationsApi, {
				update: (_scope, request) => record("state", request),
				updatePackage: (_scope, request) => record("package", request),
				install: (_scope, request) =>
					record("install", request).pipe(
						Effect.map((result) => ({ ...result, activationId: "a" })),
					),
				uninstall: () =>
					Effect.fail(
						new AuthenticatedApiError({
							cause: new PluginConflictError({
								reason: { code: "entity-referenced", pluginId: installation.pluginId },
							}),
						}),
					),
				inspect: (_scope, request) =>
					Ref.update(calls, (all) => [...all, { request, method: "inspect" }]).pipe(
						Effect.as({
							operations: [],
							configSchema: { fields: {}, unknownKeys: "strict" as const },
							metadata: {
								icon: installation.icon,
								name: installation.name,
								version: installation.version,
								packageId: installation.packageId,
								description: installation.description,
							},
						}),
					),
			}),
		);
	}),
);

const scope = { userId: "user", serverUrl: ServerOrigin.make("https://ryot.example") };

layer(PluginManagementService.layer.pipe(Layer.provideMerge(dependencies)))((test) => {
	test.effect(
		"keeps quarantined installations in the management read model",
		() =>
			Effect.gen(function* () {
				const installation = managedInstallation();
				const client = createRyotClient(
					createTestRyotAdapter({
						query: () =>
							Effect.succeed({
								data: {
									installations: {
										type: "rows",
										items: [installation],
										pageInfo: { limit: 100, hasMore: false, nextCursor: null },
									},
								},
							}),
					}),
				);
				expect(yield* (yield* PluginManagementService).load(client)).toEqual([installation]);
			}),
		testTimeout,
	);
	test.effect(
		"re-enables the retained installation without uploading or selecting the system copy",
		() =>
			Effect.gen(function* () {
				const installation = managedInstallation();
				const service = yield* PluginManagementService;
				expect(
					yield* service.execute(scope, { installation, kind: "state", isHidden: false }),
				).toEqual({ id: installation.installationId, pluginId: installation.pluginId });
				expect(yield* (yield* Commands).calls).toEqual([
					{
						method: "state",
						request: {
							payload: { isHidden: false },
							params: { installationId: "private-installation" },
						},
					},
				]);
			}),
		testTimeout,
	);
	test.effect(
		"explains why an installation that data still references cannot be removed",
		() =>
			Effect.gen(function* () {
				const service = yield* PluginManagementService;
				const error = yield* Effect.flip(
					service.execute(scope, { kind: "uninstall", installation: managedInstallation() }),
				);
				expect(error.detail).toBe("Your library still has entities that use this plugin.");
			}),
		testTimeout,
	);
	test.effect(
		"inspects an uploaded archive against the selected installation",
		() =>
			Effect.gen(function* () {
				const installation = managedInstallation();
				const service = yield* PluginManagementService;
				yield* service.inspect(scope, { installation, uploadToken: "archive-token" });
				yield* service.inspect(scope, { uploadToken: "install-token" });
				expect((yield* (yield* Commands).calls).slice(-2)).toEqual([
					{
						method: "inspect",
						request: {
							payload: { uploadToken: "archive-token", installationId: "private-installation" },
						},
					},
					{ method: "inspect", request: { payload: { uploadToken: "install-token" } } },
				]);
			}),
		testTimeout,
	);
	test.effect(
		"installs and updates packages from uploaded archive tokens with replacement config",
		() =>
			Effect.gen(function* () {
				const installation = managedInstallation();
				const service = yield* PluginManagementService;
				const config = { region: "eu" };
				yield* service.execute(scope, { config, kind: "install", uploadToken: "install-token" });
				yield* service.execute(scope, {
					config,
					installation,
					kind: "package",
					uploadToken: "archive-token",
				});
				yield* service.execute(scope, { config, installation, kind: "configure" });
				expect((yield* (yield* Commands).calls).slice(-3)).toEqual([
					{ method: "install", request: { payload: { config, uploadToken: "install-token" } } },
					{
						method: "package",
						request: {
							params: { installationId: "private-installation" },
							payload: { config, contentHash: "source-hash", uploadToken: "archive-token" },
						},
					},
					{
						method: "state",
						request: { payload: { config }, params: { installationId: "private-installation" } },
					},
				]);
			}),
		testTimeout,
	);
});
