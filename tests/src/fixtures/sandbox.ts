import { Effect } from "effect";

import { assertCompleted, requirePresent } from "~/support/assertions";

import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { type PollOptions, pollUntil } from "./polling";

type EnqueueSandboxBody = ContractPayload<"sandbox", "enqueue">;
type SandboxExecutionError = NonNullable<CompletedSandboxResult["error"]>;
type CreateSandboxScriptBody = ContractPayload<"sandbox", "createScript">;
type CompletedSandboxResult = Extract<SandboxResult, { status: "completed" }>;
type SandboxResult = Exclude<ContractSuccess<"sandbox", "getResult">, { status: "pending" }>;

export const createSandboxScript = (client: Client, body: CreateSandboxScriptBody) =>
	Effect.gen(function* () {
		const script = yield* client.call((c) => c.sandbox.createScript({ payload: body }));
		requirePresent(script.id, "Failed to create sandbox script");
		return script;
	});

export const enqueueSandboxScript = (client: Client, body: EnqueueSandboxBody) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) => c.sandbox.enqueue({ payload: body }));
		return { jobId: requirePresent(result.jobId, "Failed to enqueue sandbox script") };
	});

export const pollSandboxResult = (client: Client, jobId: string, options: PollOptions = {}) =>
	pollUntil(
		`sandbox job '${jobId}'`,
		Effect.gen(function* () {
			const result = yield* client.call((c) => c.sandbox.getResult({ path: { jobId } }));
			return result.status !== "pending" ? result : null;
		}),
		{ timeoutMs: 120_000, ...options },
	);

function formatSandboxExecutionError(error: SandboxExecutionError) {
	const location = error.line ? ` at ${error.line}${error.column ? `:${error.column}` : ""}` : "";
	return `[${error.phase}] ${error.message}${location}${error.stack ? `\n${error.stack}` : ""}`;
}

export function requireCompletedSandboxValue(result: SandboxResult, label = "sandbox job") {
	assertCompleted(result, label);
	if (result.error) {
		throw new Error(`${label} execution failed: ${formatSandboxExecutionError(result.error)}`);
	}
	return result.value;
}
