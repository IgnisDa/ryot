import { expect } from "bun:test";

import { SandboxRunError } from "@ryot-app/contract/errors";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import { UserId } from "@ryot-app/contract/schema/brands";
import { hostSuccess } from "@ryot-app/plugin-backend-sdk/wire";
import { SandboxHostFunctions } from "@ryot-app/sandbox/host/host-functions";
import { automationRunSubject } from "@ryot-app/sandbox/host/run-input.test-support";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { CurrentJobId } from "#platform/jobs/worker";

import {
	makeSubjectRunInput,
	makeUserPluginRevision,
} from "../authorization/principal.test-support";
import { ScriptHostImplementations } from "./host-implementations";
import { unusedSandboxHostImplementations } from "./host-implementations.test-support";
import { SandboxHostFunctionsLive } from "./sandbox-host-live";

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
