import { expect, layer } from "@effect/vitest";
import { createRyotClient } from "@ryot-app/client-sdk";
import { createTestRyotAdapter } from "@ryot-app/client-sdk/testing";
import { PluginConflictError } from "@ryot-app/contract/modules/plugins/schemas";
import { TemporaryUploadToken } from "@ryot-app/contract/modules/uploads/schemas";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { decodeServerOrigin } from "#/api/origin";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import { TemporaryUploads } from "#/modules/assets/temporary-uploads";

import { PluginManagementService } from "./management";
import { managedInstallation } from "./management.test-fixtures";

class Commands extends Context.Service<
	Commands,
	{ readonly calls: Effect.Effect<readonly unknown[]> }
>()("test/PluginManagementCommands") {}

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
				uninstall: () =>
					Effect.fail(
						new AuthenticatedApiError({
							cause: new PluginConflictError({
								reason: { code: "entity-referenced", pluginId: installation.pluginId },
							}),
						}),
					),
			}),
			Context.add(TemporaryUploads, {
				outcome: () => Effect.succeed({ outcome: "failure", reason: "transport" }),
				upload: (_scope, request) =>
					Ref.update(calls, (all) => [...all, { request, method: "upload" }]).pipe(
						Effect.as(
							Schema.decodeSync(TemporaryUploadToken)({
								token: "archive-token",
								expiresAt: "2026-10-13T00:00:00.000Z",
							}),
						),
					),
			}),
		);
	}),
);

layer(PluginManagementService.layer.pipe(Layer.provideMerge(dependencies)))((test) => {
	test.effect("keeps quarantined installations in the management read model", () =>
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
	);
	test.effect(
		"re-enables the retained installation without uploading or selecting the system copy",
		() =>
			Effect.gen(function* () {
				const installation = managedInstallation();
				const service = yield* PluginManagementService;
				const scope = { userId: "user", serverUrl: decodeServerOrigin("https://ryot.example") };
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
	);
	test.effect("explains why an installation that data still references cannot be removed", () =>
		Effect.gen(function* () {
			const service = yield* PluginManagementService;
			const error = yield* Effect.flip(
				service.execute(
					{ userId: "user", serverUrl: decodeServerOrigin("https://ryot.example") },
					{ kind: "uninstall", installation: managedInstallation() },
				),
			);
			expect(error.detail).toBe("Your library still has entities that use this plugin.");
		}),
	);
	test.effect("updates only the displayed private installation at its expected source hash", () =>
		Effect.gen(function* () {
			const installation = managedInstallation();
			const service = yield* PluginManagementService;
			const file = new File(["archive bytes"], "whiskey.zip", { type: "application/zip" });
			yield* service.execute(
				{ userId: "user", serverUrl: decodeServerOrigin("https://ryot.example") },
				{ file, installation, kind: "package" },
			);
			expect((yield* (yield* Commands).calls).slice(-2)).toEqual([
				{
					method: "upload",
					request: { source: file, fileName: "whiskey.zip", contentType: "application/zip" },
				},
				{
					method: "package",
					request: {
						params: { installationId: "private-installation" },
						payload: { contentHash: "source-hash", uploadToken: "archive-token" },
					},
				},
			]);
		}),
	);
});
