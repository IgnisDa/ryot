import { PluginHttpRateLimit } from "@ryot-app/contract/modules/plugins/manifest";
import { workflowDurableResultSchema } from "@ryot-app/sandbox-sdk/workflow";
import { Schema } from "effect";

import { ProviderHttpAdmissionDeclaration, ProviderHttpTicket } from "../provider-http-admission";
import { SandboxHttpRedirect } from "./runtime-host-functions";

export const SandboxHttpPolicy = Schema.Struct({
	hash: Schema.String,
	origin: Schema.String,
	durationMs: Schema.Int,
	matched: Schema.Literal(true),
	declaration: PluginHttpRateLimit,
});

export const SandboxHttpProgress = Schema.Struct({
	url: Schema.String,
	blockedUntilMs: Schema.NullOr(Schema.Int),
	redirect: Schema.NullOr(SandboxHttpRedirect),
	attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	terminalRateLimit: Schema.NullOr(workflowDurableResultSchema),
	networkAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	hop: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 })),
	blockWaitAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	admissionAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	coordinationAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	registrationAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	coordinationBackoffAttempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
	cleanup: Schema.NullOr(
		Schema.Struct({ ticket: ProviderHttpTicket, declaration: ProviderHttpAdmissionDeclaration }),
	),
	pendingBlock: Schema.NullOr(
		Schema.Struct({
			declaration: ProviderHttpAdmissionDeclaration,
			delayMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
		}),
	),
});
export type SandboxHttpProgress = typeof SandboxHttpProgress.Type;
