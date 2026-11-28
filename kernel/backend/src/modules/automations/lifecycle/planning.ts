import type { DbError } from "@ryot-app/contract/errors";
import {
	type AutomationBatchChangePayload,
	AutomationPluginAfterRun,
	type AutomationRun,
	AutomationTrigger,
	type LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationRunId,
	AutomationTriggerId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, type Effect, Schema, Struct } from "effect";

import type { WriteTransaction } from "#platform/db/write-transaction";

export const lifecycleTriggerId = (input: {
	itemIdentity: string;
	discriminator: string;
	kind: AutomationTrigger["kind"];
	executionId: AutomationTrigger["causation"]["executionId"];
}) =>
	AutomationTriggerId.make(
		`trigger_${sha256Base64Url(
			stableStringify([
				input.executionId,
				input.itemIdentity,
				input.kind.category,
				input.kind.resource,
				input.kind.operation,
				input.discriminator,
			]),
		)}`,
	);

export const lifecycleRunId = (
	input: Pick<AutomationRun, "pluginId" | "hookSlug" | "triggerId" | "executionUserId">,
) =>
	AutomationRunId.make(
		`run_${sha256Base64Url(
			stableStringify([
				input.triggerId,
				input.pluginId === null ? ["kernel"] : ["plugin", input.pluginId],
				input.hookSlug,
				input.executionUserId === null ? ["system"] : ["user", input.executionUserId],
			]),
		)}`,
	);

export type LifecyclePlan = {
	readonly wasCreated: boolean;
	readonly trigger: AutomationTrigger;
	readonly runs: ReadonlyArray<AutomationRun>;
};

export type LifecyclePlanningResult =
	| LifecyclePlan
	| {
			readonly trigger: null;
			readonly _tag: "NoHooks";
			readonly wasCreated: false;
			readonly runs: readonly [];
	  };

const LifecycleDispatchRun = Schema.Struct(
	Struct.pick(AutomationPluginAfterRun.fields, ["id", "status", "hookSlug", "triggerId"]),
);

export const LifecycleDispatchPlan = Schema.Struct({
	triggerId: AutomationTrigger.fields.id,
	runs: Schema.Array(LifecycleDispatchRun),
	blockedReason: AutomationTrigger.fields.blockedReason,
});
export type LifecycleDispatchPlan = typeof LifecycleDispatchPlan.Type;

export const toLifecycleDispatchPlan = ({
	runs,
	trigger,
}: LifecyclePlan): LifecycleDispatchPlan => ({
	triggerId: trigger.id,
	blockedReason: trigger.blockedReason,
	runs: runs.map((run) => ({
		id: run.id,
		status: run.status,
		hookSlug: run.hookSlug,
		triggerId: run.triggerId,
	})),
});

export type LifecycleBatchResource = AutomationBatchChangePayload["resource"];

export type CommittedLifecycleWork<A> = {
	readonly result: A;
	readonly dispatch: ReadonlyArray<LifecycleDispatchPlan>;
};

export type LifecycleBatchChange = {
	readonly scopeUserId: null | UserId;
	readonly payload: AutomationBatchChangePayload["items"][number];
};

export type LifecycleBatchInput = {
	readonly command: LifecycleCommand;
	readonly identity: ReadonlyArray<string>;
	readonly resource: LifecycleBatchResource;
};

export class LifecyclePersistenceError extends Schema.TaggedError<
	LifecyclePersistenceError,
	{ readonly brand: unique symbol }
>()("LifecyclePersistenceError", {
	code: Schema.Literals(["active-transaction-required", "postcommit-requires-root"]),
}) {}

export class LifecycleWork extends Context.Service<
	LifecycleWork,
	{
		derive: (
			triggers: ReadonlyArray<AutomationTrigger>,
			transaction: WriteTransaction,
		) => Effect.Effect<ReadonlyArray<AutomationTrigger>, DbError>;
	}
>()("@ryot-app/kernel-backend/modules/automations/lifecycle/planning/LifecycleWork") {}

export class LifecyclePlanner extends Context.Service<
	LifecyclePlanner,
	{
		/**
		 * Takes the users' catalog lock on the caller's transaction: their ingestion fence, every
		 * plugin's configuration lock and shared locks on its plugin and installation rows, held to the
		 * transaction's end.
		 */
		lockCatalog: (
			users: ReadonlyArray<null | UserId>,
			transaction: WriteTransaction,
		) => Effect.Effect<void, DbError>;
		planBatch: (
			transaction: WriteTransaction,
			input: LifecycleBatchInput,
		) => Effect.Effect<ReadonlyArray<LifecycleDispatchPlan>, DbError>;
		planChange: (
			input: { trigger: AutomationTrigger },
			transaction: WriteTransaction,
		) => Effect.Effect<ReadonlyArray<LifecycleDispatchPlan>, DbError>;
		recordBatchChange: (
			transaction: WriteTransaction,
			id: string,
			change: LifecycleBatchChange & { readonly index: number },
		) => Effect.Effect<void, DbError>;
		/** Plans a committed change or signal trigger's after hooks on the caller's transaction. */
		plan: (input: {
			trigger: AutomationTrigger;
			transaction: WriteTransaction;
			recipients?: ReadonlyArray<UserId>;
		}) => Effect.Effect<LifecyclePlanningResult, DbError>;
		/** Plans committed changes together, one list of dispatch plans per trigger; derived writes join the first. */
		planChanges: (
			triggers: ReadonlyArray<AutomationTrigger>,
			transaction: WriteTransaction,
		) => Effect.Effect<ReadonlyArray<ReadonlyArray<LifecycleDispatchPlan>>, DbError>;
		prepareBatch: (
			transaction: WriteTransaction,
			input: LifecycleBatchInput & { scopes: ReadonlyArray<null | UserId> },
		) => Effect.Effect<{ id: string; hasCandidates: boolean }, DbError>;
	}
>()("@ryot-app/kernel-backend/modules/automations/lifecycle/planning/LifecyclePlanner") {}
