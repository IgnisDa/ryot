import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import type { UserSandboxRunInput } from "@ryot-app/sandbox/host/invocation";
import { sameRevisionPin } from "@ryot-app/sandbox/protocol/principal";
import { Effect } from "effect";

import { ImportSourceStateStore } from "./runtime/source-state-store";

export const admittedImportRunId = (input: UserSandboxRunInput) => {
	const subject = input.principal.subject;
	if (subject.type !== "user") {
		return null;
	}
	return subject.importRunId ?? subject.integrationRunId ?? null;
};

export const makeAdmittedExecutionStateLoader = Effect.gen(function* () {
	const sourceStates = yield* ImportSourceStateStore;
	return Effect.fn("loadAdmittedImportExecutionState")(function* (
		input: UserSandboxRunInput,
		runId: ImportRunId,
	) {
		const subject = input.principal.subject;
		if (subject.type !== "user") {
			return yield* Effect.fail("Admitted ingestion execution settings are unavailable");
		}
		const state = yield* sourceStates
			.load({ runId, userId: subject.userId, accountGeneration: subject.accountGeneration })
			.pipe(Effect.mapError(() => "Admitted ingestion execution settings are unavailable"));
		const plugin = input.principal.pluginRevision;
		if (
			!plugin ||
			state.pluginId !== plugin.id ||
			state.pluginRevision.id !== plugin.id ||
			!sameRevisionPin(state.pluginRevision, plugin)
		) {
			return yield* Effect.fail("Admitted ingestion execution settings are unavailable");
		}
		return state;
	});
});
