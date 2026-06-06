import { requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload, ContractSuccess } from "./contract-client";
import { type PollOptions, pollUntil } from "./polling";

type CreateSandboxScriptBody = ContractPayload<"sandbox", "createScript">;

type EnqueueSandboxBody = ContractPayload<"sandbox", "enqueue">;
type SandboxResult = Exclude<ContractSuccess<"sandbox", "getResult">, { status: "pending" }> | null;

export async function createSandboxScript(
	client: Client,
	body: CreateSandboxScriptBody,
) {
	const script = await client.run((c) => c.sandbox.createScript({ payload: body }));
	requirePresent(script.id, "Failed to create sandbox script");
	return script;
}

export async function enqueueSandboxScript(
	client: Client,
	body: EnqueueSandboxBody,
) {
	const result = await client.run((c) => c.sandbox.enqueue({ payload: body }));

	return {
		jobId: requirePresent(result.jobId, "Failed to enqueue sandbox script"),
	};
}

export async function pollSandboxResult(
	client: Client,
	jobId: string,
	options: PollOptions = {},
) {
	return pollUntil(
		`sandbox job '${jobId}'`,
		async (): Promise<SandboxResult> => {
			const result = await client.run((c) => c.sandbox.getResult({ path: { jobId } }));

			return result.status !== "pending" ? result : null;
		},
		options,
	);
}
