import { type SandboxFailureKind, unknownToMessage } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { SandboxBoundaryReason } from "@ryot-app/contract/modules/scripts/boundary-reason";
import type { SandboxExecutionGrants } from "@ryot-app/contract/modules/scripts/schemas";
import type { SandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import type { SandboxHostImplementationMap as SdkSandboxHostImplementationMap } from "@ryot-app/plugin-backend-sdk/core";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import type {
	WorkflowDurableResult,
	WorkflowInlineRequest,
} from "@ryot-app/plugin-backend-sdk/workflow";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, PlatformError, type Schema } from "effect";

import type { SandboxInlineProgress } from "./inline-progress";
import type { SandboxPinnedJournal } from "./pinned-journal";
import type { SandboxPrincipal } from "./principal";
import type { SandboxShortWait } from "./short-wait";

export type SandboxInlineDurableHost = {
	readonly capabilities: ReadonlyArray<SandboxHostCapability>;
	readonly settle: (
		requests: ReadonlyArray<WorkflowInlineRequest>,
		wait: SandboxShortWait,
		checkpoint: (progress: SandboxInlineProgress) => Effect.Effect<void>,
	) => Effect.Effect<ReadonlyArray<WorkflowDurableResult | null> | null>;
	readonly cancel: (progress: ReadonlyArray<SandboxInlineProgress>) => Effect.Effect<void>;
};

export type SandboxRunInput = {
	readonly lane: ExecutionLane;
	readonly context: unknown;
	readonly startedAt: string;
	readonly executionId: string;
	readonly compiledCode: string;
	readonly compiledFormat: number;
	readonly workflowExecutionId?: string;
	readonly replayJournal?: SandboxPinnedJournal;
	readonly hostCallDiscriminator?: number;
	readonly grants?: SandboxExecutionGrants;
	readonly principal: SandboxPrincipal;
	readonly inlineDurableHost?: SandboxInlineDurableHost;
};

export type BoundHostFunction = (
	args: ReadonlyArray<unknown>,
) => Effect.Effect<unknown, Schema.SchemaError | SandboxHostError>;

export type SandboxHostImplementationMap = SdkSandboxHostImplementationMap<SandboxRunInput>;

export const toSandboxHostError = (error: unknown): SandboxHostError => {
	if (
		isObjectRecord(error) &&
		isObjectRecord(error["reason"]) &&
		typeof error["reason"]["code"] === "string" &&
		isJsonValue(error["reason"])
	) {
		return {
			data: error["reason"],
			message:
				typeof error["message"] === "string" && error["message"].length > 0
					? error["message"]
					: error["reason"]["code"],
		};
	}
	if (isObjectRecord(error) && typeof error["message"] === "string") {
		return { ...error, message: error["message"] };
	}
	return { message: unknownToMessage(error) };
};

export const sandboxHostFailure = (
	message: string,
	data?: SandboxBoundaryReason,
): Effect.Effect<never, SandboxHostError> =>
	Effect.fail(
		data === undefined ? toSandboxHostError(message) : { message, data: toSandboxJsonValue(data) },
	);

const EXHAUSTED_RESOURCE_CODES = new Set(["EAGAIN", "EMFILE", "ENFILE", "ENOMEM"]);

export const sandboxPlatformFailureKind = (error: unknown): SandboxFailureKind => {
	if (
		!(error instanceof PlatformError.PlatformError) ||
		!(error.reason instanceof PlatformError.SystemError)
	) {
		return "infrastructure";
	}
	if (error.reason._tag === "Busy" || error.reason._tag === "WouldBlock") {
		return "resource-unavailable";
	}
	const cause = error.reason.cause;
	const code = isObjectRecord(cause) ? cause["code"] : undefined;
	return typeof code === "string" && EXHAUSTED_RESOURCE_CODES.has(code)
		? "resource-unavailable"
		: "infrastructure";
};

export const sandboxHostEffect = <A, E>(effect: Effect.Effect<A, E>) =>
	effect.pipe(Effect.mapError(toSandboxHostError));

export const toSandboxJsonValue = (value: unknown): JsonValue =>
	isJsonValue(value) ? value : null;
