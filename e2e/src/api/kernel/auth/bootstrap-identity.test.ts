import {
	instanceAdminUsersRecipe,
	userLifecycleOperationRecipe,
} from "@ryot-app/ryotql-recipes/instance-admin";
import { Deferred, Effect, Option, Queue, Schema } from "effect";

import { adminHeaders } from "~/fixtures/kernel/admin";
import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { getApiClient } from "~/fixtures/kernel/contract-client";
import { executeAdminRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import {
	encodePluginSourceFiles,
	installTestSupportSystemPlugin,
	testPluginEntitySchema,
	testPluginManifest,
	testPluginPackageId,
} from "~/fixtures/kernel/test-plugin";
import {
	deleteUserAndWait,
	pollUserLifecycleOperation,
	requestUserReset,
} from "~/fixtures/kernel/user-lifecycle";
import { assertCompleted, requirePresent } from "~/support/assertions";
import { expect, it } from "~/support/effect-test";
import { startFakeHttpServerScoped } from "~/support/fake-http-server";
import { getServerLogFile } from "~/support/harness-target";
import { startIsolatedHarness } from "~/support/isolated-harness";

it.live("joins creation and reset bootstrap for each recreated account generation", () =>
	Effect.gen(function* () {
		const requests = yield* Queue.unbounded<string>();
		let stage = "start";
		let operationId: string | undefined;
		const step = Effect.fnUntraced(function* <A, E, R>(name: string, work: Effect.Effect<A, E, R>) {
			stage = name;
			yield* Effect.logInfo("Bootstrap identity stage started", { stage, operationId });
			return yield* work.pipe(
				Effect.timeoutOrElse({
					duration: "45 seconds",
					orElse: () => Effect.die(new Error(`Bootstrap identity timed out: ${name}`)),
				}),
			);
		});
		let held: Deferred.Deferred<void> | undefined;
		let targetUserId = "";
		yield* Effect.acquireRelease(
			startIsolatedHarness("Bootstrap Identity"),
			(harness) => harness.stop,
		);
		const upstream = yield* startFakeHttpServerScoped((url) =>
			Effect.gen(function* () {
				const [userId, entityId] = url.pathname.slice(1).split("/").map(decodeURIComponent);
				if (!userId || !entityId) {
					return Response.json({ error: "Missing bootstrap marker identity" }, { status: 400 });
				}
				yield* Queue.offer(requests, url.pathname);
				const gate = held;
				yield* Effect.logInfo("Bootstrap identity HTTP request", {
					userId,
					entityId,
					held: gate !== undefined && userId === targetUserId,
				});
				if (gate && userId === targetUserId) {
					yield* Deferred.await(gate);
				}
				return Response.json({ ok: true });
			}),
		);
		const entry = "backend/scripts/bootstrap.sandbox.ts";
		const upstreamUrl = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.String))(
			upstream.url,
		);
		const scriptSlug = "bootstrap.record-identity";
		yield* Effect.acquireRelease(
			step(
				"install recording plugin",
				installTestSupportSystemPlugin({
					manifest: testPluginManifest({
						packageId: testPluginPackageId(),
						pluginSlug: `bootstrap-identity-${crypto.randomUUID()}`,
						userBootstrap: [
							{ scriptSlug, slug: "record-identity", description: "Record bootstrap identity" },
						],
						entitySchemas: [
							testPluginEntitySchema({
								slug: "bootstrap-marker",
								propertiesSchema: { fields: {} },
							}),
						],
						scripts: [
							{
								entry,
								kind: "script",
								slug: scriptSlug,
								capabilities: ["httpCall"],
								requiredPluginConfigKeys: [],
								name: "Record bootstrap identity",
							},
						],
					}),
					files: encodePluginSourceFiles({
						[entry]: `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { ascending, column, defineRecipe, eq, executeRyotqlRecipe, literal, selectedField, selectedOptionalRow, table } from "@ryot-app/plugin-backend-sdk/ryotql";
const bootstrapOwnerRecipe = defineRecipe((entityId: string) => {
 const entity = table("entity", "marker");
 return {
  map: ({ owner }) => Result.succeed(owner),
  queries: { owner: selectedOptionalRow(entity, {
   where: eq(column(entity, "id"), literal(entityId)),
   orderBy: [ascending(column(entity, "id"))],
   selection: { userId: selectedField(column(entity, "userId"), Schema.String) },
  }) },
 };
});
export const manifest = defineManifest({ kind: "script", slug: "${scriptSlug}", name: "Record bootstrap identity" });
export default defineScript({
 manifest, input: Schema.Struct({}), output: Schema.Null,
 run: (_input, host) => Effect.gen(function* () {
  const [marker] = yield* host.ensureUserEntities([{ entitySchemaSlug: "bootstrap-marker", name: "Bootstrap marker", properties: {} }]);
  if (!marker) return yield* Effect.fail(new Error("Bootstrap marker missing"));
  const owner = yield* executeRyotqlRecipe(host.executeRyotql, bootstrapOwnerRecipe(marker.entityId));
  if (!owner) return yield* Effect.fail(new Error("Bootstrap marker owner missing"));
  yield* host.httpCall("POST", ${upstreamUrl} + "/" + encodeURIComponent(owner.userId) + "/" + encodeURIComponent(marker.entityId));
  return null;
 }),
});
`,
					}),
				}),
			),
			({ pluginId, activationId }) =>
				getApiClient()
					.call(
						(contract) =>
							contract.testSupport.uninstallSystemPlugin({ params: { pluginId, activationId } }),
						adminHeaders(),
					)
					.pipe(Effect.orDie),
		);
		const { email, userId } = yield* step("create authenticated user", createAuthenticatedClient());
		targetUserId = userId;
		yield* Effect.addFinalizer(() =>
			deleteUserAndWait(userId).pipe(
				Effect.timeout("15 seconds"),
				Effect.catchCause((cause) =>
					Effect.logWarning("Bootstrap identity user cleanup failed", cause),
				),
			),
		);
		yield* Effect.addFinalizer(() =>
			held ? Deferred.succeed(held, undefined).pipe(Effect.asVoid) : Effect.void,
		);
		const nextBootstrap = Effect.fnUntraced(function* () {
			for (;;) {
				const path = yield* Queue.take(requests);
				if (path.startsWith(`/${userId}/`)) {
					return path;
				}
			}
		});
		yield* Effect.addFinalizer((exit) =>
			exit._tag === "Failure"
				? Effect.gen(function* () {
						yield* Effect.logError("Bootstrap identity failure", exit.cause, {
							stage,
							userId,
							operationId,
							serverLog: getServerLogFile(),
							requests: upstream.requests.map(({ path }) => path),
						});
						if (operationId !== undefined) {
							yield* Effect.logError(
								"Bootstrap identity operation state",
								yield* executeAdminRyotQLRecipe(
									userLifecycleOperationRecipe({ id: operationId }),
								).pipe(Effect.timeout("5 seconds"), Effect.result),
							);
						}
						yield* Effect.logError(
							"Bootstrap identity user state",
							yield* executeAdminRyotQLRecipe(
								instanceAdminUsersRecipe({ limit: 10, search: email }),
							).pipe(
								Effect.map(({ items }) => items.map(({ id, disabledAt }) => ({ id, disabledAt }))),
								Effect.timeout("5 seconds"),
								Effect.result,
							),
						);
					})
				: Effect.void,
		);
		const executions = [yield* step("observe creation bootstrap", nextBootstrap())];
		for (let reset = 0; reset < 2; reset++) {
			operationId = undefined;
			held = yield* Deferred.make<void>();
			const accepted = yield* step(`request reset ${reset + 1}`, requestUserReset(userId));
			operationId = accepted.operationId;
			const markerPath = yield* step(`observe reset ${reset + 1} bootstrap`, nextBootstrap());
			stage = `assert reset ${reset + 1} is held`;
			expect(markerPath).not.toBe(executions.at(-1));
			const pending = Option.getOrThrow(
				yield* executeAdminRyotQLRecipe(userLifecycleOperationRecipe({ id: accepted.operationId })),
			);
			expect(pending.status).toBe("running");
			const user = requirePresent(
				(yield* executeAdminRyotQLRecipe(
					instanceAdminUsersRecipe({ limit: 10, search: email }),
				)).items.find((item) => item.id === userId),
				"Recreated user is missing",
			);
			expect(user.disabledAt).not.toBeNull();
			yield* Deferred.succeed(held, undefined);
			const completed = yield* step(
				`complete reset ${reset + 1}`,
				pollUserLifecycleOperation(accepted.operationId),
			);
			assertCompleted(completed, `Reset operation ${accepted.operationId}`);
			const enabled = yield* step(
				`verify reset ${reset + 1} enabled the user`,
				executeAdminRyotQLRecipe(instanceAdminUsersRecipe({ limit: 10, search: email })),
			);
			expect(
				requirePresent(
					enabled.items.find((item) => item.id === userId),
					"Reset user is missing",
				).disabledAt,
			).toBeNull();
			executions.push(markerPath);
			held = undefined;
		}
		stage = "assert one bootstrap invocation per account generation";
		expect(new Set(executions).size).toBe(3);
		expect(
			upstream.requests.map(({ path }) => path).filter((path) => path.startsWith(`/${userId}/`)),
		).toEqual(executions);
	}),
);
