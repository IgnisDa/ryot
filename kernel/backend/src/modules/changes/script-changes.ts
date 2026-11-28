import { DbError } from "@ryot-app/contract/errors";
import { CommittedChanges } from "@ryot-app/contract/modules/changes/change-set";
import { PolicyRejected, PolicyUnavailable } from "@ryot-app/contract/modules/changes/policies";
import { EntityUserDataBadRequest } from "@ryot-app/contract/modules/entity-user-data/schemas";
import { sandboxSubjectUserId } from "@ryot-app/contract/modules/scripts/schemas";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Effect, Function, Layer, Schema } from "effect";

import {
	type CommitReceipt,
	idempotencyIdentity,
	IdempotencyKeys,
	keyedReceipt,
	unrecorded,
} from "#modules/mutations/idempotency";
import { PluginUserSettingsPatchError } from "#modules/plugins/preferences/user-settings-writer";
import {
	ScriptChanges,
	type ScriptChangesInput,
	ScriptChangesRejected,
} from "#modules/scripts/executions/script-changes";
import { scriptChangesCommand } from "#modules/scripts/host/execution-context";

import { ChangeSetRejected } from "./authority";
import { CommitConflict } from "./conflict";
import { type ChangeSetFailure, ChangeSets } from "./service";

const hasReasonCode = Schema.is(Schema.Struct({ reason: Schema.Struct({ code: Schema.String }) }));

const invalid = (message: string) =>
	new ScriptChangesRejected({ reason: { message, code: "invalid" } });

/** The messages of user data refusals the user's choice of entities causes, which no retry changes. */
const userDataRefusals: Partial<Record<EntityUserDataBadRequest["reason"]["code"], Message>> = {
	"required-field": kernelMessage("error.entity-user-data.required-field"),
	"operation-denied": kernelMessage("error.entity-user-data.operation-denied"),
	"same-entity-merge": kernelMessage("error.entity-user-data.same-entity-merge"),
	"entity-schema-mismatch": kernelMessage("error.entity-user-data.schema-mismatch"),
	"identity-property-mismatch": kernelMessage("error.entity-user-data.identity-mismatch"),
};

const rejection = (error: typeof ChangeSetFailure.Type) => {
	if (error instanceof DbError) {
		return error;
	}
	if (error instanceof PolicyUnavailable) {
		return new ScriptChangesRejected({ reason: { code: "policy-unavailable" } });
	}
	if (error instanceof PolicyRejected) {
		return error.reason.code === "policy-rejected"
			? new ScriptChangesRejected({
					reason: { code: "policy-rejected", message: error.reason.message },
				})
			: invalid(`policies: ${error.reason.code}`);
	}
	const refusal =
		error instanceof EntityUserDataBadRequest ? userDataRefusals[error.reason.code] : undefined;
	if (refusal !== undefined) {
		return new ScriptChangesRejected({ reason: { code: "refused", message: refusal } });
	}
	if (error instanceof CommitConflict) {
		return new ScriptChangesRejected({ reason: { code: "conflict", conflict: error.reason.code } });
	}
	if (error instanceof ChangeSetRejected) {
		return invalid(`${error.part}: ${error.message}`);
	}
	if (error instanceof PluginUserSettingsPatchError) {
		return invalid(`settings: ${error.message}`);
	}
	return invalid(`${error._tag}${hasReasonCode(error) ? `: ${error.reason.code}` : ""}`);
};

/** `ScriptChanges` over the caller's `ChangeSets`. */
export const ScriptChangesLayer = Layer.effect(
	ScriptChanges,
	Effect.gen(function* () {
		const changeSets = yield* ChangeSets;
		const keys = yield* IdempotencyKeys.make;
		const commit = Effect.fnUntraced(function* <A>(
			input: ScriptChangesInput & { readonly receipt: CommitReceipt<CommittedChanges, A> },
		) {
			const command = scriptChangesCommand({
				...input,
				executionId: AutomationExecutionId.make(input.executionId),
			});
			return yield* changeSets
				.commitScript(input.changes, command, input.receipt)
				.pipe(Effect.mapError(rejection));
		});
		const commitKeyed = (input: ScriptChangesInput) => {
			const userId = sandboxSubjectUserId(input.principal.subject);
			return commit({
				...input,
				receipt:
					userId === null
						? unrecorded(Function.identity<CommittedChanges>)
						: keyedReceipt(
								keys,
								idempotencyIdentity({
									userId,
									key: input.executionId,
									kind: "script-changes",
									request: input.changes ?? null,
								}),
								CommittedChanges,
								(committed: CommittedChanges) => committed,
							),
			});
		};
		return ScriptChanges.of({ commit, commitKeyed });
	}),
);
