import {
	instanceAdminUsersRecipe,
	userLifecycleOperationRecipe,
} from "@ryot-app/ryotql-recipes/instance-admin";
import { randomUuid } from "@ryot-app/testing/random";
import { Deferred, Effect, Option, Queue, Schema } from "effect";

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
import { startIsolatedHarness } from "~/support/isolated-harness";

it.live("joins creation and reset bootstrap for each recreated account", () =>
	Effect.gen(function* () {
		const requests = yield* Queue.unbounded<string>();
		let held: undefined | Deferred.Deferred<void>;
		const { target } = yield* Effect.acquireRelease(
			startIsolatedHarness("Bootstrap Identity"),
			(harness) => harness.stop,
		);
		const upstream = yield* startFakeHttpServerScoped((url) =>
			Effect.gen(function* () {
				yield* Queue.offer(requests, url.pathname);
				if (held) {
					yield* Deferred.await(held);
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
			installTestSupportSystemPlugin({
				target,
				manifest: testPluginManifest({
					packageId: testPluginPackageId(),
					pluginSlug: `bootstrap-identity-${yield* randomUuid}`,
					userBootstrap: [
						{ scriptSlug, slug: "record-identity", description: "Record bootstrap identity" },
					],
					entitySchemas: [
						testPluginEntitySchema({ slug: "bootstrap-marker", propertiesSchema: { fields: {} } }),
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
import { changesOutputSchema } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
export const manifest = defineManifest({ kind: "script", slug: "${scriptSlug}", name: "Record bootstrap identity" });
export default defineScript({
 manifest, input: Schema.Struct({}), output: changesOutputSchema,
 run: (_input, host) => host.httpCall("POST", ${upstreamUrl} + "/bootstrap").pipe(
  Effect.as({ changes: { entities: { ensures: [{ entitySchemaSlug: "bootstrap-marker", name: "Bootstrap marker", properties: {} }] } } }),
 ),
});
`,
				}),
			}),
			({ pluginId, activationId }) =>
				getApiClient(target)
					.adminCall((contract) =>
						contract.testSupport.uninstallSystemPlugin({ params: { pluginId, activationId } }),
					)
					.pipe(Effect.orDie),
		);
		const { email, userId } = yield* createAuthenticatedClient(target);
		yield* Effect.addFinalizer(() => deleteUserAndWait(userId, target).pipe(Effect.orDie));
		yield* Effect.addFinalizer(() =>
			held ? Deferred.succeed(held, undefined).pipe(Effect.asVoid) : Effect.void,
		);
		yield* Queue.take(requests);
		for (let reset = 0; reset < 2; reset++) {
			held = yield* Deferred.make<void>();
			const accepted = yield* requestUserReset(userId, target);
			yield* Queue.take(requests);
			const pending = Option.getOrThrow(
				yield* executeAdminRyotQLRecipe(
					userLifecycleOperationRecipe,
					{ id: accepted.operationId },
					target,
				),
			);
			expect(pending.status).toBe("running");
			const user = requirePresent(
				(yield* executeAdminRyotQLRecipe(instanceAdminUsersRecipe, { search: email }, target, {
					pages: { users: { limit: 10 } },
				})).items.find((item) => item.id === userId),
				"Recreated user is missing",
			);
			expect(user.disabledAt).not.toBeNull();
			yield* Deferred.succeed(held, undefined);
			const completed = yield* pollUserLifecycleOperation(accepted.operationId, target);
			assertCompleted(completed, `Reset operation ${accepted.operationId}`);
			const enabled = yield* executeAdminRyotQLRecipe(
				instanceAdminUsersRecipe,
				{ search: email },
				target,
				{ pages: { users: { limit: 10 } } },
			);
			expect(
				requirePresent(
					enabled.items.find((item) => item.id === userId),
					"Reset user is missing",
				).disabledAt,
			).toBeNull();
			held = undefined;
		}
		expect(upstream.requests).toHaveLength(3);
	}),
);
