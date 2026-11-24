import { DbError } from "@ryot-app/contract/errors";
import {
	CommitConflictCode,
	CommittedChanges,
} from "@ryot-app/contract/modules/changes/change-set";
import { EntityUserDataBadRequest } from "@ryot-app/contract/modules/entity-user-data/schemas";
import { sandboxSubjectUserId } from "@ryot-app/contract/modules/scripts/schemas";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Effect, Layer, Schema } from "effect";

import {
	AutomationPolicyExecutionError,
	isTransientPolicyFailure,
} from "#modules/automations/lifecycle/policies";
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
	if (error instanceof AutomationPolicyExecutionError && isTransientPolicyFailure(error)) {
		return new ScriptChangesRejected({
			reason: { code: "policy-unavailable", message: `${error.runId} failed with ${error.kind}` },
		});
	}
	const refusal =
		error instanceof EntityUserDataBadRequest ? userDataRefusals[error.reason.code] : undefined;
	if (refusal !== undefined) {
		return new ScriptChangesRejected({ reason: { code: "refused", message: refusal } });
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
