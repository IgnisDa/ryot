import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { type PollOptions, pollUntil } from "./polling";

type CreateSandboxScriptBody = ContractPayload<"sandbox", "createScript">;

type EnqueueSandboxBody = ContractPayload<"sandbox", "enqueue">;
type SandboxResult = Exclude<ContractSuccess<"sandbox", "getResult">, { status: "pending" }> | null;
type SandboxCompletedResult = Extract<NonNullable<SandboxResult>, { status: "completed" }>;
type TypedSandboxResult =
	| Exclude<NonNullable<SandboxResult>, { status: "completed" }>
	| (Omit<SandboxCompletedResult, "timing"> & {
			timing?: { totalMs?: number; executionMs?: number };
	  });

export async function createSandboxScript(
	client: Client,
	cookies: string,
	body: CreateSandboxScriptBody,
) {
	const script = await client.run((c) => c.sandbox.createScript({ payload: body }), {
		Cookie: cookies,
	});
	requirePresent(script.id, "Failed to create sandbox script");
	return script;
}

export async function enqueueSandboxScript(
	client: Client,
	cookies: string,
	body: EnqueueSandboxBody,
) {
	const result = await client.run((c) => c.sandbox.enqueue({ payload: body }), {
		Cookie: cookies,
	});

	return {
		jobId: requirePresent(result.jobId, "Failed to enqueue sandbox script"),
	};
}

export async function pollSandboxResult(
	client: Client,
	cookies: string,
	jobId: string,
	options: PollOptions = {},
) {
	return pollUntil(
		`sandbox job '${jobId}'`,
		async () => {
			const result = await client.run((c) => c.sandbox.getResult({ path: { jobId } }), {
				Cookie: cookies,
			});

			// TODO(Task 22): Remove this tests-only sandbox assertion once the public
			// AppContract exposes typed sandbox timing details.
			return result.status !== "pending" ? (result as TypedSandboxResult) : null;
		},
		options,
	);
}
