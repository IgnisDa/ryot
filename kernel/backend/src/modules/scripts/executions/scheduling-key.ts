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

const QueueElementScheduling = Schema.Struct({
	payload: Schema.Struct({
		lane: ExecutionLane,
		principal: Schema.Struct({
			subject: ScriptExecutionPrincipal.fields.subject,
			pluginRevision: Schema.NullOr(Schema.Struct({ id: ScriptPluginRevision.fields.id })),
		}),
	}),
});
const decodeQueueElementScheduling = Schema.decodeUnknownEffect(QueueElementScheduling);

const schedulingTenant = (subject: SandboxExecutionSubject) => {
	const userId = sandboxSubjectUserId(subject);
	return userId === null ? "system" : `user:${userId}`;
};

/**
 * Orders sandbox admission by the trusted principal the backend wrote into the queue payload: the
 * execution user (or the system) is the tenant and the pinned plugin the flow within it.
 */
export const sandboxSchedulingKey = (
	element: unknown,
): Effect.Effect<FairQueueFlow, Schema.SchemaError> =>
	Effect.map(decodeQueueElementScheduling(element), ({ payload }) => ({
		lane: payload.lane,
		tenant: schedulingTenant(payload.principal.subject),
		plugin: payload.principal.pluginRevision?.id ?? "kernel",
	}));
