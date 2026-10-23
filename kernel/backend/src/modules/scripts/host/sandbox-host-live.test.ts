import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { POLICY_SAFE_SANDBOX_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import { UserId } from "@ryot-app/contract/schema/brands";
import { SandboxHostFunctions } from "@ryot-app/sandbox/host/host-functions";
import { automationRunSubject } from "@ryot-app/sandbox/host/run-input.test-support";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect, Layer } from "effect";

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
	it.effect("binds only capabilities eligible for the execution principal", () =>
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
	);

	it.effect("rejects a principal that fails backend validation", () =>
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
	);
});
