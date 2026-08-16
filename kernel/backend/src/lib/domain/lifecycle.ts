import type { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRun,
	AutomationTrigger,
	type AutomationBatchChangePayload,
	type LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationRunId,
	AutomationTriggerId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, type Effect, Schema, Struct } from "effect";

import type { Database } from "#lib/infrastructure/db/service";

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
	input: Pick<AutomationRun, "triggerId" | "pluginId" | "hookSlug" | "executionUserId">,
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

export const LifecyclePlannedPolicy = Schema.Struct({
	position: Schema.Finite,
	runId: AutomationRun.members[1].fields.id,
	batchFrequency: PluginHook.members[0].fields.batchFrequency,
});
export type LifecyclePlannedPolicy = typeof LifecyclePlannedPolicy.Type;

export type LifecyclePlan = {
	readonly wasCreated: boolean;
	readonly trigger: AutomationTrigger;
	readonly runs: ReadonlyArray<AutomationRun>;
	readonly policies: ReadonlyArray<LifecyclePlannedPolicy>;
};

export const LifecycleDispatchRun = Schema.Struct(
	Struct.pick(AutomationRun.members[1].fields, [
		"id",
		"stage",
		"status",
		"delivery",
		"hookSlug",
		"triggerId",
	]),
);
export type LifecycleDispatchRun = typeof LifecycleDispatchRun.Type;

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
	runs: runs.flatMap((run) =>
		run.stage === "after"
			? [
					{
						id: run.id,
						stage: run.stage,
						status: run.status,
						delivery: run.delivery,
						hookSlug: run.hookSlug,
						triggerId: run.triggerId,
					},
				]
			: [],
	),
});

export type LifecycleBatchResource = AutomationBatchChangePayload["resource"];

export type LifecycleBatchInput = {
	readonly command: LifecycleCommand;
	readonly identity: ReadonlyArray<string>;
	readonly resource: LifecycleBatchResource;
	readonly plans: ReadonlyArray<LifecyclePlan>;
};

export type CommittedLifecycleWork<A> = {
	readonly result: A;
	readonly plans: ReadonlyArray<LifecyclePlan>;
};

export class LifecyclePersistenceError extends Schema.TaggedError<LifecyclePersistenceError>()(
	"LifecyclePersistenceError",
	{
		code: Schema.Literals([
			"active-transaction-required",
			"before-policy-requires-owner",
			"postcommit-requires-root",
		]),
	},
) {}

export class LifecyclePlanner extends Context.Service<
	LifecyclePlanner,
	{
		plan: (input: {
			trigger: AutomationTrigger;
			recipients?: ReadonlyArray<UserId>;
			excludedOncePerSubjectPolicies?: ReadonlyArray<Pick<AutomationRun, "pluginId" | "hookSlug">>;
		}) => Effect.Effect<LifecyclePlan, DbError, Database>;
		planBatch: (
			input: LifecycleBatchInput,
		) => Effect.Effect<ReadonlyArray<LifecyclePlan>, DbError, Database>;
	}
>()("LifecyclePlanner") {}
