import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { SandboxExecutionSubject } from "@ryot-app/contract/modules/sandbox/schemas";
import { Effect, Schema } from "effect";

import type { FairQueueFlow } from "#lib/infrastructure/fair-queue-store";
import {
	SandboxExecutionPrincipal,
	SandboxPluginRevision,
} from "#lib/infrastructure/sandbox-runtime/execution-principal";

const QueueElementScheduling = Schema.Struct({
	payload: Schema.Struct({
		lane: ExecutionLane,
		principal: Schema.Struct({
			subject: SandboxExecutionPrincipal.fields.subject,
			pluginRevision: Schema.NullOr(Schema.Struct({ id: SandboxPluginRevision.fields.id })),
		}),
	}),
});
const decodeQueueElementScheduling = Schema.decodeUnknownEffect(QueueElementScheduling);

const schedulingTenant = (subject: SandboxExecutionSubject) => {
	if (subject.type === "system") {
		return "system";
	}
	const userId = subject.type === "user" ? subject.userId : subject.executionUserId;
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
