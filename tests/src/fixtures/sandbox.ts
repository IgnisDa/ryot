import { SandboxScriptId } from "@ryot/contract/schema/brands";

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

export async function createSandboxScript(client: Client, body: CreateSandboxScriptBody) {
	const script = await client.run((c) => c.sandbox.createScript({ payload: body }));
	requirePresent(script.id, "Failed to create sandbox script");
	return script;
}

export async function createAndPromoteSandboxScript(client: Client, source: string) {
	const script = await createSandboxScript(client, { source });
	const backend = getBackendClient();
	const scriptId = SandboxScriptId.make(script.id);
	try {
		const before = await backend.run(
			(c) => c.testSupport.getSandboxScript({ path: { scriptId } }),
			adminHeaders,
		);
		const after = await backend.run(
			(c) => c.testSupport.promoteSandboxScript({ path: { scriptId } }),
			adminHeaders,
		);
		if (
			JSON.stringify(representationValues(after)) !== JSON.stringify(representationValues(before))
		) {
			throw new Error("Sandbox script promotion changed its compiled representation");
		}

		return script;
	} catch (error) {
		await backend
			.run((c) => c.testSupport.deleteSandboxScript({ path: { scriptId } }), adminHeaders)
			.catch((cleanupError) => {
				console.error("[sandbox] failed promotion cleanup", cleanupError);
			});
		throw error;
	}
}

export async function replaceSandboxScriptCompiledRepresentation(
	client: Client,
	targetScriptId: string,
	source: string,
) {
	const replacement = await createSandboxScript(client, { source });
	const backend = getBackendClient();
	const replacementId = SandboxScriptId.make(replacement.id);
	const targetId = SandboxScriptId.make(targetScriptId);
	let temporaryRemoved = false;
	try {
		const before = await backend.run(
			(c) => c.testSupport.getSandboxScript({ path: { scriptId: replacementId } }),
			adminHeaders,
		);
		const after = await backend.run(
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
	} finally {
		const deleted = await backend
			.run(
				(c) => c.testSupport.deleteSandboxScript({ path: { scriptId: replacementId } }),
				adminHeaders,
			)
			.catch((error) => {
				console.error("[sandbox] temporary replacement cleanup failed", error);
				return null;
			});
		temporaryRemoved = deleted?.id === replacementId;
	}
	if (!temporaryRemoved) {
		throw new Error("Failed to remove temporary replacement sandbox script");
	}
}

export async function enqueueSandboxScript(client: Client, body: EnqueueSandboxBody) {
	const result = await client.run((c) => c.sandbox.enqueue({ payload: body }));

	return {
		jobId: requirePresent(result.jobId, "Failed to enqueue sandbox script"),
	};
}

export async function pollSandboxResult(client: Client, jobId: string, options: PollOptions = {}) {
	return pollUntil(
		`sandbox job '${jobId}'`,
		async (): Promise<SandboxResult | null> => {
			const result = await client.run((c) => c.sandbox.getResult({ path: { jobId } }));

			return result.status !== "pending" ? result : null;
		},
		{ timeoutMs: 120_000, ...options },
	);
}

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
