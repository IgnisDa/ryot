import {
	AutomationEventDraft,
	AutomationRequestPayload,
	type AutomationRun,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { EventCreateItemError } from "@ryot-app/contract/modules/events/schemas";
import { AutomationHookSlug, PluginId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect, Schema } from "effect";

import type { LifecyclePlan } from "#lib/domain/lifecycle";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";

import { EventCreateWorkflowError, type EventCreateWorkflowPayload } from "./event-create-workflow";
import { resolveEventCreateItemScopes } from "./event-creation";

export type EventRequest = Extract<
	AutomationRequestPayload,
	{ resource: "event"; operation: "create" }
>;
export type PolicyIdentity = Pick<AutomationRun, "pluginId" | "hookSlug">;

const PolicyIdentity = Schema.Struct({
	hookSlug: AutomationHookSlug,
	pluginId: Schema.NullOr(PluginId),
});
const EventPolicyOutcome = Schema.Union([
	Schema.TaggedStruct("Accepted", {
		processed: Schema.Array(PolicyIdentity),
		request: AutomationRequestPayload.members[3],
	}),
	Schema.TaggedStruct("Skipped", {
		reason: Schema.String,
		processed: Schema.Array(PolicyIdentity),
	}),
	Schema.TaggedStruct("Failed", {
		error: EventCreateItemError,
		processed: Schema.Array(PolicyIdentity),
	}),
]);

export const runEventCreatePolicies = Effect.fn("runEventCreatePolicies")(function* (
	payload: EventCreateWorkflowPayload,
	itemIndex: number,
	plan: LifecyclePlan,
	propertiesSchema: AppSchema,
	processed: PolicyIdentity[],
) {
	const execution = yield* LifecycleExecution;
	const source = plan.trigger.payload;
	if (
		source?.category !== "request" ||
		source.resource !== "event" ||
		source.operation !== "create"
	) {
		return yield* Effect.die("Expected event-create request trigger");
	}
	const skipQueuedPolicies = execution.skipQueuedPolicies({ triggerId: plan.trigger.id });
	const reached: PolicyIdentity[] = [];
	let request: EventRequest = source;
	const outcome = yield* Effect.gen(function* () {
		if (plan.trigger.blockedReason) {
			return yield* new EventCreateItemError({
				reason: { triggerId: plan.trigger.id, code: "automation-limit-reached" },
			});
		}
		const ordered = yield* Effect.forEach(plan.policies, (policy) => {
			const run = plan.runs.find((candidate) => candidate.id === policy.runId);
			return run
				? Effect.succeed({ ...policy, run })
				: new EventCreateItemError({
						reason: { runId: policy.runId, code: "policy-execution-failed" },
					});
		});
		ordered.sort(
			(a, b) =>
				a.position - b.position ||
				(a.run.pluginId ?? "").localeCompare(b.run.pluginId ?? "") ||
				a.run.hookSlug.localeCompare(b.run.hookSlug),
		);
		for (const policy of ordered) {
			const output = yield* execution
				.executePolicy({ payload: request, runId: policy.runId })
				.pipe(
					Effect.mapError(
						(error) =>
							new EventCreateItemError({
								reason: { runId: error.runId, code: "policy-execution-failed" },
							}),
					),
				);
			if (policy.batchFrequency === "once-per-subject") {
				reached.push({ pluginId: policy.run.pluginId, hookSlug: policy.run.hookSlug });
			}
			if (output.action === "reject") {
				return { processed: reached, reason: output.reason, _tag: "Skipped" as const };
			}
			if (output.action === "transform") {
				if (output.payload.resource !== "event" || output.payload.operation !== "create") {
					return yield* new EventCreateItemError({
						reason: { runId: policy.runId, code: "policy-execution-failed" },
					});
				}
				request = Object.assign({}, request, {
					draft: {
						...request.draft,
						properties: output.payload.draft.properties,
						sessionEntityId: output.payload.draft.sessionEntityId,
					},
				});
			}
		}
		return { request, processed: reached, _tag: "Accepted" as const };
	}).pipe(
		Effect.catchTag("EventCreateItemError", (error) =>
			Effect.succeed({ error, processed: reached, _tag: "Failed" as const }),
		),
	);
	const recorded = yield* makeActivity({
		success: EventPolicyOutcome,
		execute: Effect.succeed(outcome),
		name: `policy-outcome-${itemIndex}`,
	});
	processed.push(...recorded.processed);
	if (recorded._tag === "Failed") {
		return yield* skipQueuedPolicies.pipe(Effect.andThen(Effect.fail(recorded.error)));
	}
	if (recorded._tag === "Skipped") {
		yield* skipQueuedPolicies;
		return { reason: recorded.reason, kind: "skipped" as const };
	}
	const accepted = recorded.request;
	return yield* Effect.gen(function* () {
		const draft = yield* makeActivity({
			name: `validate-event-${itemIndex}`,
			success: AutomationEventDraft satisfies DurableSchema,
			error: EventCreateWorkflowError satisfies DurableSchema,
			execute: Effect.gen(function* () {
				const scope = yield* resolveEventCreateItemScopes({
					userId: payload.userId,
					item: { ...accepted.draft, sessionEntityId: accepted.draft.sessionEntityId ?? undefined },
				});
				const properties = yield* parseAppSchemaProperties({
					kind: "Event",
					propertiesSchema,
					properties: accepted.draft.properties,
				}).pipe(
					Effect.mapError(
						() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
					),
				);
				return yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
					...accepted.draft,
					properties,
					sessionEntityId: scope.sessionEntityId ?? null,
				}).pipe(
					Effect.mapError(
						() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
					),
				);
			}),
		});
		return { draft, kind: "ready" as const };
	}).pipe(Effect.tapError(() => skipQueuedPolicies));
});
