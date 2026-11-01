import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type SandboxExecutionSubject,
	sandboxSubjectUserId,
} from "@ryot-app/contract/modules/scripts/schemas";
import { Effect, Schema } from "effect";

import {
	ScriptExecutionPrincipal,
	ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import type { FairQueueFlow } from "#platform/workflow/fair-queue-store";

const SchedulingPrincipal = Schema.Struct({
	subject: ScriptExecutionPrincipal.fields.subject,
	pluginRevision: Schema.NullOr(Schema.Struct({ id: ScriptPluginRevision.fields.id })),
});

const QueueElementScheduling = Schema.Struct({
	payload: Schema.Struct({
		lane: ExecutionLane,
		journalLength: Schema.Int,
		principal: SchedulingPrincipal,
		recoveryAttempt: Schema.optional(Schema.Int),
	}),
});
const decodeQueueElementScheduling = Schema.decodeUnknownEffect(QueueElementScheduling);

const schedulingTenant = (subject: SandboxExecutionSubject) => {
	const userId = sandboxSubjectUserId(subject);
	return userId === null ? "system" : `user:${userId}`;
};

/**
 * Identifies sandbox work by the trusted principal the backend pinned: the execution user (or the
 * system) is the tenant and the pinned plugin the flow within it.
 */
export const sandboxSchedulingIdentity = (input: {
	readonly lane: ExecutionLane;
	readonly principal: typeof SchedulingPrincipal.Type;
}) => ({
	lane: input.lane,
	tenant: schedulingTenant(input.principal.subject),
	plugin: input.principal.pluginRevision?.id ?? "kernel",
});

// A policy or required hook blocks the write that awaits it under a deadline; a replay or recovery
// continues a run that already holds admitted work.
const schedulingUrgency = (
	payload: typeof QueueElementScheduling.Type.payload,
): FairQueueFlow["urgency"] => {
	const { subject } = payload.principal;
	if (subject.type === "automation-run" && subject.delivery !== "async") {
		return "awaited";
	}
	return payload.journalLength > 0 || (payload.recoveryAttempt ?? 0) > 0 ? "continuation" : "fresh";
};

/** Orders sandbox queue admission by scheduling identity, then by urgency within a flow. */
export const sandboxSchedulingKey = (
	element: unknown,
): Effect.Effect<FairQueueFlow, Schema.SchemaError> =>
	Effect.map(decodeQueueElementScheduling(element), ({ payload }) => ({
		...sandboxSchedulingIdentity(payload),
		urgency: schedulingUrgency(payload),
	}));
