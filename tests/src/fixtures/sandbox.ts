import { requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ClientBody, ClientSuccess } from "./backend-client";
import { type PollOptions, pollUntil } from "./polling";

type CreateSandboxScriptBody = ClientBody<"sandbox", "createScript">;

type EnqueueSandboxBody = ClientBody<"sandbox", "enqueue">;
type SandboxResult = Exclude<ClientSuccess<"sandbox", "getResult">, { status: "pending" }> | null;
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
	const { data, response } = await client.sandbox.createScript({
		body,
		headers: { Cookie: cookies },
	});

	const script = requireResponseData(response, data, "Failed to create sandbox script");
	requirePresent(script.id, "Failed to create sandbox script");
	return script;
}

export async function enqueueSandboxScript(
	client: Client,
	cookies: string,
	body: EnqueueSandboxBody,
) {
	const { data, response } = await client.sandbox.enqueue({
		body,
		headers: { Cookie: cookies },
	});

	return {
		jobId: requirePresent(
			requireResponseData(response, data, "Failed to enqueue sandbox script").jobId,
			"Failed to enqueue sandbox script",
		),
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
			const { data, response } = await client.sandbox.getResult({
				params: { path: { jobId } },
				headers: { Cookie: cookies },
			});
			const result = requireResponseData(
				response,
				data,
				`Failed to poll sandbox result '${jobId}'`,
			);

			// TODO(Task 22): Remove this tests-only sandbox assertion once the public
			// AppContract exposes typed sandbox timing details.
			return result.status !== "pending" ? (result as TypedSandboxResult) : null;
		},
		options,
	);
}
