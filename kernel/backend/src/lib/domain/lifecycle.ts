import type { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationRun,
	AutomationTrigger,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import {
	AutomationRunId,
	AutomationTriggerId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, type Effect, Schema } from "effect";

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

export type LifecyclePlannedPolicy = { readonly runId: AutomationRun["id"] } & Required<
	Pick<Extract<PluginHook, { stage: "before" }>, "position">
> &
	Pick<Extract<PluginHook, { stage: "before" }>, "batchFrequency">;

export type LifecyclePlan = {
	readonly wasCreated: boolean;
	readonly trigger: AutomationTrigger;
	readonly runs: ReadonlyArray<AutomationRun>;
	readonly policies: ReadonlyArray<LifecyclePlannedPolicy>;
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
	}
>()("LifecyclePlanner") {}
