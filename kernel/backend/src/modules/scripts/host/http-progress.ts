import { httpCallResponseSchema } from "@ryot-app/plugin-backend-sdk/core";
import { jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import {
	workflowHostRequestSchema,
	workflowInlineRequestSchema,
} from "@ryot-app/plugin-backend-sdk/workflow";
import { Schema } from "effect";

import { HttpRateLimitPolicyDeclaration } from "#modules/plugins/catalog/http-rate-limits";

import {
	PROVIDER_HTTP_TICKET_LIMITS,
	ProviderHttpAdmissionDeclaration,
	ProviderHttpTicket,
} from "./http-admission";
import { SandboxHttpHop } from "./runtime-host-functions";

export const SandboxHttpPolicy = Schema.Struct({
	hash: Schema.String,
	origin: Schema.String,
	durationMs: Schema.Int,
	matched: Schema.Literal(true),
	declaration: HttpRateLimitPolicyDeclaration,
});

export const SandboxHttpRateLimitResult = Schema.Struct({
	state: Schema.Literal("failure"),
	error: Schema.Struct({
		message: Schema.Literal("HTTP 429"),
		data: Schema.Struct({ ...httpCallResponseSchema.fields, status: Schema.Literal(429) }),
	}),
});

const SandboxHttpPhase = Schema.Union([
	Schema.TaggedStruct("Admitting", { rateLimit: Schema.NullOr(SandboxHttpRateLimitResult) }),
	Schema.TaggedStruct("ApplyingRateLimitBlock", {
		rateLimit: SandboxHttpRateLimitResult,
		declaration: ProviderHttpAdmissionDeclaration,
		delayMs: Schema.Int.check(
			Schema.isBetween({ minimum: 0, maximum: PROVIDER_HTTP_TICKET_LIMITS.retryAfterMs }),
		),
	}),
	Schema.TaggedStruct("WaitingForRateLimitBlock", {
		rateLimit: SandboxHttpRateLimitResult,
		blockedUntilMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	}),
]);

export const SandboxHttpProgress = Schema.Struct({
	current: SandboxHttpHop,
	phase: SandboxHttpPhase,
	attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	networkAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	blockWaitAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	admissionAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	coordinationAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	registrationAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	coordinationBackoffAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	cleanup: Schema.NullOr(
		Schema.Struct({ ticket: ProviderHttpTicket, declaration: ProviderHttpAdmissionDeclaration }),
	),
});
export type SandboxHttpProgress = typeof SandboxHttpProgress.Type;

export const ScriptInlineProgress = Schema.Union([
	Schema.TaggedStruct("Completed", {
		value: jsonValueSchema,
		request: workflowInlineRequestSchema,
	}),
	Schema.TaggedStruct("Http", {
		progress: SandboxHttpProgress,
		request: workflowHostRequestSchema,
	}),
]);
export type ScriptInlineProgress = typeof ScriptInlineProgress.Type;
