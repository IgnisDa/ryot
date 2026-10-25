import { assert, expect, it } from "@effect/vitest";
import { EnqueueSandboxBody } from "@ryot-app/contract/modules/scripts/schemas";
import { requestUserWorkArgsSchema } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "effect";

import { skipsAfterHooks } from "../authorization/principal";
import { makeUserRunInput } from "../authorization/principal.test-support";
import { sandboxLifecycleCommand } from "./execution-context";

it.effect("propagates trusted suppression without changing write authority or causation", () =>
	Effect.gen(function* () {
		const input = makeUserRunInput({
			hostCallDiscriminator: 3,
			workflowExecutionId: "parent-workflow",
		});
		const subject = input.principal.subject;
		assert(subject.type === "user");
		const skipped = {
			...input,
			principal: { ...input.principal, subject: { ...subject, afterHooks: "skip" as const } },
		};
		const normal = yield* sandboxLifecycleCommand(input, "api", "updateEvents");
		const command = yield* sandboxLifecycleCommand(skipped, "api", "updateEvents");
		expect(command).toEqual({ ...normal, writeContext: skipped.principal });
		expect(skipsAfterHooks(command.writeContext)).toBe(true);
		expect(command.accountGeneration).toEqual(subject.accountGeneration);
		expect(command.causation.source).toBe("api");
		const forged = yield* sandboxLifecycleCommand(
			{ ...input, context: { afterHooks: "skip", principal: skipped.principal } },
			"api",
			"updateEvents",
		);
		expect(forged).toEqual(normal);
		expect(skipsAfterHooks(forged.writeContext)).toBe(false);
	}),
);

it.effect("refuses authored authority fields at public script and user-work boundaries", () =>
	Effect.gen(function* () {
		yield* Effect.flip(
			Schema.decodeUnknownEffect(EnqueueSandboxBody)({ scriptId: "script", afterHooks: "skip" }),
		);
		yield* Effect.flip(
			Schema.decodeUnknownEffect(requestUserWorkArgsSchema)([
				{ input: {}, key: "key", scope: "scope", afterHooks: "skip" },
				{ scriptSlug: "worker", referenceKind: "script" },
			]),
		);
	}),
);
