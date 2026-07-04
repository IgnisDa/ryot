import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Exit } from "effect";

import { assertCompleted, requirePresent } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { type ContractPayload, type ContractSuccess, getBackendClient } from "./contract-client";
import { type PollOptions, pollUntil } from "./polling";

type EnqueueSandboxBody = ContractPayload<"sandbox", "enqueue">;
type SandboxExecutionError = NonNullable<CompletedSandboxResult["error"]>;
type CreateSandboxScriptBody = ContractPayload<"sandbox", "createScript">;
type CompletedSandboxResult = Extract<SandboxResult, { status: "completed" }>;
type StoredScriptRepresentation = ContractSuccess<"testSupport", "getSandboxScript">;
type SandboxResult = Exclude<ContractSuccess<"sandbox", "getResult">, { status: "pending" }>;

const representationValues = (row: StoredScriptRepresentation) => [
	row.slug,
	row.name,
	row.source,
	row.compiledCode,
	row.compiledFormat,
	JSON.stringify(row.metadata),
];

export const createSandboxScript = (client: Client, body: CreateSandboxScriptBody) =>
	Effect.gen(function* () {
		const script = yield* client.call((c) => c.sandbox.createScript({ payload: body }));
		requirePresent(script.id, "Failed to create sandbox script");
		return script;
	});

export const createAndPromoteSandboxScript = (client: Client, source: string) =>
	Effect.gen(function* () {
		const script = yield* createSandboxScript(client, { source });
		const backend = getBackendClient();
		const scriptId = SandboxScriptId.make(script.id);
		return yield* Effect.gen(function* () {
			const before = yield* backend.call(
				(c) => c.testSupport.getSandboxScript({ path: { scriptId } }),
				adminHeaders,
			);
			const after = yield* backend.call(
				(c) => c.testSupport.promoteSandboxScript({ path: { scriptId } }),
				adminHeaders,
			);
			if (
				JSON.stringify(representationValues(after)) !== JSON.stringify(representationValues(before))
			) {
				throw new Error("Sandbox script promotion changed its compiled representation");
			}
			return script;
		}).pipe(
			Effect.onError(() =>
				backend
					.call((c) => c.testSupport.deleteSandboxScript({ path: { scriptId } }), adminHeaders)
					.pipe(
						Effect.catchAll((cleanupError) =>
							Effect.logError("[sandbox] failed promotion cleanup", cleanupError),
						),
					),
			),
		);
	});

export const replaceSandboxScriptCompiledRepresentation = (
	client: Client,
	targetScriptId: string,
	source: string,
) =>
	Effect.gen(function* () {
		const replacement = yield* createSandboxScript(client, { source });
		const backend = getBackendClient();
		const replacementId = SandboxScriptId.make(replacement.id);
		const targetId = SandboxScriptId.make(targetScriptId);

		const mainExit = yield* Effect.gen(function* () {
			const before = yield* backend.call(
				(c) => c.testSupport.getSandboxScript({ path: { scriptId: replacementId } }),
				adminHeaders,
			);
			const after = yield* backend.call(
				(c) =>
					c.testSupport.patchSandboxScript({
						path: { scriptId: targetId },
						payload: {
							slug: before.slug,
							name: before.name,
							source: before.source,
							metadata: before.metadata,
							compiledCode: before.compiledCode,
							compiledFormat: before.compiledFormat,
						},
					}),
				adminHeaders,
			);
			if (
				JSON.stringify(representationValues(after)) !== JSON.stringify(representationValues(before))
			) {
				throw new Error("Sandbox script replacement changed its compiled representation");
			}
		}).pipe(Effect.exit);

		const deleted = yield* backend
			.call(
				(c) => c.testSupport.deleteSandboxScript({ path: { scriptId: replacementId } }),
				adminHeaders,
			)
			.pipe(
				Effect.catchAll((error) =>
					Effect.logError("[sandbox] temporary replacement cleanup failed", error).pipe(
						Effect.as(null),
					),
				),
			);
		const temporaryRemoved = deleted?.id === replacementId;

		if (Exit.isFailure(mainExit)) {
			yield* mainExit;
		}
		if (!temporaryRemoved) {
			throw new Error("Failed to remove temporary replacement sandbox script");
		}
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
