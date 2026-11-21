import { SandboxRunError } from "@ryot-app/contract/errors";
import { ChangesOutput } from "@ryot-app/contract/modules/changes/change-set";
import type { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import {
	ScriptExecutionPrincipal,
	type ScriptInstallationInitialization,
	type ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { sandboxStartedAt } from "#modules/scripts/host/execution-context";
import { SandboxRepository } from "#modules/scripts/registry/repository";

import { ScriptCalls } from "./calls";
import { infrastructureRunError } from "./run-error";
import { ScriptChanges, scriptChangesFailure } from "./script-changes";

export type UserBootstrapRun = {
	readonly userId: UserId;
	readonly executionId: string;
	readonly scriptId: SandboxScriptId;
	readonly pluginRevision?: ScriptPluginRevision;
	readonly initialization?: ScriptInstallationInitialization;
};

/**
 * Runs a user bootstrap script under its pinned principal with the bootstrapped user's ID as input,
 * and commits the changes it returns once per bootstrap execution and script content.
 */
export const runUserBootstrapScript = Effect.fn("runUserBootstrapScript")(function* (
	run: UserBootstrapRun,
) {
	const scripts = yield* SandboxRepository;
	const calls = yield* ScriptCalls;
	const changes = yield* ScriptChanges;
	const subject = { userId: run.userId, type: "user" as const };
	const pin = yield* scripts
		.getScriptPin(run.scriptId, run.pluginRevision, subject, run.initialization)
		.pipe(Effect.catchTag("DbError", (error) => Effect.fail(infrastructureRunError(error))));
	if (!pin) {
		return yield* new SandboxRunError({
			kind: "missing-artifact",
			message: "User bootstrap script is unavailable",
		});
	}
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject }).pipe(
		Effect.mapError(infrastructureRunError),
	);
	const result = yield* calls.run({
		principal,
		lane: "background",
		executionId: run.executionId,
		input: { userId: run.userId },
	});
	if (result.error) {
		return { error: result.error };
	}
	const output = yield* Schema.decodeUnknownEffect(ChangesOutput)(result.value).pipe(
		Effect.orElseSucceed(() => null),
	);
	if (output === null) {
		return { error: { message: "A user bootstrap script must return { changes? }" } };
	}
	return yield* changes
		.commitKeyed({
			principal,
			lane: "background",
			changes: output.changes,
			occurredAt: yield* sandboxStartedAt,
			executionId: `${run.executionId}-${pin.contentHash}`,
		})
		.pipe(
			Effect.as({ error: null }),
			Effect.catchTags({
				DbError: (error) => Effect.fail(infrastructureRunError(error)),
				ScriptChangesRejected: (error) =>
					Effect.succeed({ error: { message: scriptChangesFailure(error).message } }),
			}),
		);
});
