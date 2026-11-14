import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import { UserId } from "@ryot-app/contract/schema/brands";
import { hostSuccess } from "@ryot-app/plugin-backend-sdk/wire";
import { SandboxHostFunctions } from "@ryot-app/sandbox/host/host-functions";
import { automationRunSubject } from "@ryot-app/sandbox/host/run-input.test-support";
import { SandboxStateStore } from "@ryot-app/sandbox/host/state-store";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer, Redacted } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { CurrentJobId } from "#platform/jobs/worker";
import { makeAppConfigLayer } from "#testing/effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#testing/isolated-database";

import {
	makeSubjectRunInput,
	makeUserPluginRevision,
} from "../authorization/principal.test-support";
import { ScriptHostImplementations } from "./host-implementations";
import { unusedSandboxHostImplementations } from "./host-implementations.test-support";
import { SandboxHostFunctionsLive, SandboxStateStoreLive } from "./sandbox-host-live";

const hostFunctionsLayer = SandboxHostFunctionsLive.pipe(
	Layer.provide(Layer.succeed(ScriptHostImplementations, unusedSandboxHostImplementations())),
);

layer(hostFunctionsLayer)("SandboxHostFunctionsLive", (it) => {
	it.effect(
		"binds only capabilities eligible for the execution principal",
		() =>
			Effect.gen(function* () {
				const { bind } = yield* SandboxHostFunctions;
				const before = yield* bind(
					makeSubjectRunInput(automationRunSubject("before", UserId.make("user_1"))),
				);
				const after = yield* bind(
					makeSubjectRunInput(automationRunSubject("after", UserId.make("user_1"))),
				);

				expect(new Set(Object.keys(before))).toEqual(
					new Set(
						POLICY_SAFE_SANDBOX_CAPABILITIES.filter(
							(capability) => capability !== "log" && capability !== "span",
						),
					),
				);
				expect(after).toHaveProperty("createEvents");
				expect(after).toHaveProperty("sendNotification");
				expect(after).not.toHaveProperty("ensureUserEntities");
				expect(after).not.toHaveProperty("upsertGlobalEntities");
			}),
		testTimeout,
	);

	it.effect(
		"rejects a principal that fails backend validation",
		() =>
			Effect.gen(function* () {
				const { bind } = yield* SandboxHostFunctions;
				const exit = yield* Effect.exit(
					bind(
						makeSubjectRunInput(
							automationRunSubject("after", UserId.make("user_1")),
							null,
							{},
							{
								pluginRevision: makeUserPluginRevision({
									compiledHashes: {},
									slug: "other-owner",
									ownerId: UserId.make("user_2"),
								}),
							},
						),
					),
				);

				assertExitFails(
					exit,
					new SandboxRunError({
						kind: "invalid-input",
						message: "Sandbox execution principal is invalid",
					}),
				);
			}),
		testTimeout,
	);
});

const recordedJobs: Array<null | string> = [];

const recordingHostFunctionsLayer = SandboxHostFunctionsLive.pipe(
	Layer.provide(
		Layer.succeed(
			ScriptHostImplementations,
			unusedSandboxHostImplementations({
				getCachedValue: () =>
					Effect.map(CurrentJobId, (jobId) => {
						recordedJobs.push(jobId);
						return hostSuccess(null);
					}),
			}),
		),
	),
);

layer(recordingHostFunctionsLayer)("SandboxHostFunctionsLive job identity", (it) => {
	it.effect(
		"runs host calls for the job that bound them, whichever fiber settles them",
		() =>
			Effect.gen(function* () {
				const { bind } = yield* SandboxHostFunctions;
				const input = makeSubjectRunInput(automationRunSubject("after", UserId.make("user_1")));
				const fromJob = yield* bind(input).pipe(Effect.provideService(CurrentJobId, "current"));
				const fromRequest = yield* bind(input);

				for (const { getCachedValue } of [fromJob, fromRequest]) {
					assert(getCachedValue);
					yield* getCachedValue(["key"]).pipe(Effect.provideService(CurrentJobId, "finished"));
				}

				expect(recordedJobs).toEqual(["current", null]);
			}),
		testTimeout,
	);
});

const exhaustedApplicationPoolLayer = SandboxStateStoreLive.pipe(
	Layer.provide(
		Layer.unwrap(
			Effect.map(IsolatedDatabase, ({ url }) =>
				makeAppConfigLayer({
					sandbox: { workerConcurrency: 1 },
					database: { url: Redacted.make(url) },
				}),
			),
		),
	),
	Layer.provideMerge(isolatedDatabaseLayer("sandbox_state", { maxConnections: 1 })),
);

layer(exhaustedApplicationPoolLayer)("SandboxStateStoreLive", (it) => {
	it.effect(
		"keeps protection state available while application statements hold every pooled connection",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const store = yield* SandboxStateStore;
				const held = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const holder = yield* session
					.transaction(
						session
							.run((db) => db.execute(sql`select 1`))
							.pipe(
								Effect.andThen(Deferred.succeed(held, undefined)),
								Effect.andThen(Deferred.await(release)),
							),
					)
					.pipe(Effect.forkChild);
				yield* Deferred.await(held);
				const key = `sandbox:test:${yield* randomUuid}`;
				const written = yield* store.update([key], () => ({
					result: "written",
					writes: new Map([[key, { value: "protected" }]]),
				}));
				expect(written).toBe("written");
				expect(yield* store.read([key])).toEqual(new Map([[key, "protected"]]));
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(holder);
			}),
		testTimeout,
	);
});
