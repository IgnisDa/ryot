import type { ContractPayload, ContractSuccess } from "@ryot/contract/client";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { assertCompleted, requirePresent } from "~/support/assertions";

import { adminHeaders } from "./admin";
import { getBackendClient } from "./contract-client";
import { type PollOptions, pollUntil } from "./polling";
import { installTestPlugin, uninstallTestPlugin } from "./test-plugin";

type SandboxExecutionError = NonNullable<CompletedSandboxResult["error"]>;
type CompletedSandboxResult = Extract<SandboxResult, { status: "completed" }>;
type EnqueueSandboxBody = Omit<ContractPayload<"testSupport", "enqueueSandbox">, "executingUserId">;
type SandboxResult = Exclude<
	ContractSuccess<"testSupport", "getSandboxResult">,
	{ status: "pending" }
>;

export const installSandboxScript = (input: {
	name: string;
	slug: string;
	source: string;
	capabilities?: ReadonlyArray<string>;
	requiredAppConfigKeys?: ReadonlyArray<string>;
}) =>
	installTestPlugin({
		source: input.source,
		script: {
			kind: "script",
			name: input.name,
			slug: input.slug,
			capabilities: input.capabilities ?? [],
			requiredAppConfigKeys: input.requiredAppConfigKeys ?? [],
		},
	});

export const installSandboxScriptScoped = (input: Parameters<typeof installSandboxScript>[0]) =>
	Effect.acquireRelease(installSandboxScript(input), uninstallTestPlugin);

export const enqueueSandboxScript = (executingUserId: string, body: EnqueueSandboxBody) =>
	Effect.gen(function* () {
		const result = yield* getBackendClient().call(
			(c) =>
				c.testSupport.enqueueSandbox({
					payload: { ...body, executingUserId: UserId.make(executingUserId) },
				}),
			adminHeaders,
		);
		return { jobId: requirePresent(result.jobId, "Failed to enqueue sandbox script") };
	});

export const pollSandboxResult = (
	executingUserId: string,
	jobId: string,
	options: PollOptions = {},
) =>
	pollUntil(
		`sandbox job '${jobId}'`,
		Effect.gen(function* () {
			const result = yield* getBackendClient().call(
				(c) =>
					c.testSupport.getSandboxResult({
						path: { jobId },
						urlParams: { executingUserId: UserId.make(executingUserId) },
					}),
				adminHeaders,
			);
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
