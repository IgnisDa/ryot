import {
	AutomationEventDraft,
	type AutomationRequestPayload,
	type AutomationRun,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { EventCreateItemError } from "@ryot-app/contract/modules/events/schemas";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { Effect, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";

import type { LifecyclePlan } from "#lib/domain/lifecycle";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import type { DurableSchema } from "#lib/infrastructure/workflow";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";

import { EventCreateWorkflowError, type EventCreateWorkflowPayload } from "./event-create-workflow";
import { resolveEventCreateItemScopes } from "./event-creation";

export type EventRequest = Extract<
	AutomationRequestPayload,
	{ resource: "event"; operation: "create" }
>;
export type PolicyIdentity = Pick<AutomationRun, "pluginId" | "hookSlug">;

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
	let request: EventRequest = source;
	return yield* Effect.gen(function* () {
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
				(a.position ?? 1000) - (b.position ?? 1000) ||
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
				processed.push({ pluginId: policy.run.pluginId, hookSlug: policy.run.hookSlug });
			}
			if (output.action === "reject") {
				yield* execution.skipQueuedPolicies({ triggerId: plan.trigger.id });
				return { reason: output.reason, kind: "skipped" as const };
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
		const draft = yield* Activity.make({
			name: `validate-event-${itemIndex}`,
			success: AutomationEventDraft satisfies DurableSchema,
			error: EventCreateWorkflowError satisfies DurableSchema,
			execute: Effect.gen(function* () {
				const scope = yield* resolveEventCreateItemScopes({
					userId: payload.userId,
					item: { ...request.draft, sessionEntityId: request.draft.sessionEntityId ?? undefined },
				});
				const properties = yield* parseAppSchemaProperties({
					kind: "Event",
					propertiesSchema,
					properties: request.draft.properties,
				}).pipe(
					Effect.mapError(
						() => new EventCreateItemError({ reason: { code: "invalid-properties" } }),
					),
				);
				return yield* Schema.decodeUnknownEffect(AutomationEventDraft)({
					...request.draft,
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
	}).pipe(Effect.tapError(() => execution.skipQueuedPolicies({ triggerId: plan.trigger.id })));
});
