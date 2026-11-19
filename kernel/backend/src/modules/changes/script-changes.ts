import { DbError } from "@ryot-app/contract/errors";
import {
	CommitConflictCode,
	CommittedChanges,
} from "@ryot-app/contract/modules/changes/change-set";
import { sandboxSubjectUserId } from "@ryot-app/contract/modules/scripts/schemas";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { Message } from "@ryot-app/i18n/message";
import { Effect, Layer, Schema } from "effect";

import { idempotencyIdentity, IdempotencyKeys } from "#modules/mutations/idempotency";
import { PluginUserSettingsPatchError } from "#modules/plugins/preferences/user-settings-writer";
import {
	type ChangeSetReceipt,
	ScriptChanges,
	type ScriptChangesInput,
	ScriptChangesRejected,
} from "#modules/scripts/executions/script-changes";
import { scriptChangesCommand } from "#modules/scripts/host/execution-context";

import { ChangeSetRejected } from "./authority";
import { type CommitReceipt, keyedReceipt, unrecordedChanges } from "./receipts";
import { type ChangeSetFailure, ChangeSets } from "./service";

const isCommitConflict = Schema.is(
	Schema.Struct({ reason: Schema.Struct({ code: CommitConflictCode }) }),
);
const isPolicyRejection = Schema.is(
	Schema.Struct({
		_tag: Schema.Literals(["EventBadRequest", "RelationshipBadRequest"]),
		reason: Schema.Struct({ message: Message, code: Schema.Literal("policy-rejected") }),
	}),
);
const hasReasonCode = Schema.is(Schema.Struct({ reason: Schema.Struct({ code: Schema.String }) }));

const invalid = (message: string) =>
	new ScriptChangesRejected({ reason: { message, code: "invalid" } });

const rejection = (error: typeof ChangeSetFailure.Type) => {
	if (error instanceof DbError) {
		return error;
	}
	if (isPolicyRejection(error)) {
		return new ScriptChangesRejected({
			reason: { code: "policy-rejected", message: error.reason.message },
		});
	}
	if (isCommitConflict(error)) {
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
		const commitOnce = Effect.fnUntraced(function* <A>(
			input: ScriptChangesInput & { readonly receipt: CommitReceipt<A> },
		) {
			const command = yield* scriptChangesCommand({
				...input,
				executionId: AutomationExecutionId.make(input.executionId),
			}).pipe(Effect.orDie);
			return yield* changeSets
				.commitScript(input.changes, command, input.receipt)
				.pipe(Effect.mapError(rejection));
		});
		const commit = <A>(input: ScriptChangesInput & { readonly receipt: ChangeSetReceipt<A> }) =>
			commitOnce({
				...input,
				receipt: {
					load: input.receipt.load,
					record: (result) => input.receipt.record(result.committed),
				},
			});
		const commitKeyed = (input: ScriptChangesInput) => {
			const userId = sandboxSubjectUserId(input.principal.subject);
			return commitOnce({
				...input,
				receipt:
					userId === null
						? unrecordedChanges
						: keyedReceipt(
								keys,
								idempotencyIdentity({
									userId,
									key: input.executionId,
									kind: "script-changes",
									request: input.changes ?? null,
								}),
								CommittedChanges,
								(result) => result.committed,
							),
			});
		};
		return ScriptChanges.of({ commit, commitKeyed });
	}),
);
