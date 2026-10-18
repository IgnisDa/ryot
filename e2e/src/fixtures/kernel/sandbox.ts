import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { assertCompleted, requirePresent } from "~/support/assertions";

import { type Client, createAuthenticatedClient } from "./auth";
import { getApiClient } from "./contract-client";
import { pollUntil } from "./polling";
import { httpCallFailureSandboxSource } from "./sandbox-source";
import { installTestPlugin, type TestPluginScript, uninstallTestPlugin } from "./test-plugin";

type SandboxExecutionError = NonNullable<CompletedSandboxResult["error"]>;
type GenericTestPluginScript = Extract<TestPluginScript, { kind: "script" }>;
type CompletedSandboxResult = Extract<SandboxResult, { status: "completed" }>;
type EnqueueSandboxBody = Omit<ContractPayload<"testSupport", "enqueueSandbox">, "executingUserId">;
type SandboxResult = Exclude<
	ContractSuccess<"testSupport", "getSandboxResult">,
	{ status: "pending" }
>;
type InstallSandboxScriptInput = Pick<GenericTestPluginScript, "name" | "slug"> &
	Partial<Pick<GenericTestPluginScript, "capabilities" | "requiredPluginConfigKeys">> & {
		client: Client;
		source: string;
		pluginSlug?: string;
		scope?: "user" | "system";
		configSchema?: PluginManifest["configSchema"];
		entitySchemas?: PluginManifest["entitySchemas"];
		config?: ContractPayload<"plugins", "install">["config"];
	};

const installSandboxScript = (input: InstallSandboxScriptInput) => {
	const common = {
		source: input.source,
		config: input.config,
		pluginSlug: input.pluginSlug,
		configSchema: input.configSchema,
		entitySchemas: input.entitySchemas,
		script: {
			name: input.name,
			slug: input.slug,
			kind: "script" as const,
			capabilities: input.capabilities ?? [],
			requiredPluginConfigKeys: input.requiredPluginConfigKeys ?? [],
		},
	};
	return installTestPlugin(
		input.scope === "system"
			? { scope: "system", target: input.client.target, ...common }
			: { client: input.client, ...common },
	);
};

export const installSandboxScriptScoped = (input: Parameters<typeof installSandboxScript>[0]) =>
	Effect.acquireRelease(installSandboxScript(input), uninstallTestPlugin);

export const enqueueSandboxScript = (executingUserId: string, body: EnqueueSandboxBody) =>
	Effect.gen(function* () {
		const result = yield* getApiClient().adminCall((c) =>
			c.testSupport.enqueueSandbox({
				payload: { ...body, executingUserId: UserId.make(executingUserId) },
			}),
		);
		return {
			executionId: result.executionId,
			jobId: requirePresent(result.jobId, "Failed to enqueue sandbox script"),
		};
	});

export const pollSandboxResult = (executingUserId: string, jobId: string) =>
	pollUntil(
		`sandbox job '${jobId}'`,
		Effect.gen(function* () {
			const result = yield* getApiClient().adminCall((c) =>
				c.testSupport.getSandboxResult({
					params: { jobId },
					query: { executingUserId: UserId.make(executingUserId) },
				}),
			);
			return result.status !== "pending" ? result : null;
		}),
	);

export const deleteSandboxReplayProjection = (executionId: string) =>
	getApiClient().adminCall((client) =>
		client.testSupport.deleteSandboxReplayProjection({ payload: { executionId } }),
	);

export function requireCompletedSandboxValue(result: SandboxResult, label = "sandbox job") {
	assertCompleted(result, label);
	if (result.error) {
		throw new Error(`${label} execution failed: ${formatSandboxExecutionError(result.error)}`);
	}
	return result.value;
}

function formatSandboxExecutionError(error: SandboxExecutionError) {
	const location = error.line ? ` at ${error.line}${error.column ? `:${error.column}` : ""}` : "";
	return `[${error.phase}] ${error.message}${location}${error.stack ? `\n${error.stack}` : ""}`;
}

export const runSandboxHttpCall = (label: string, url: string) =>
	Effect.gen(function* () {
		const { client, userId } = yield* createAuthenticatedClient();
		const slug = `${label}-${crypto.randomUUID()}`;
		const { scriptId } = yield* installSandboxScriptScoped({
			slug,
			client,
			name: label,
			capabilities: ["httpCall"],
			source: httpCallFailureSandboxSource({ url, slug, name: label }),
		});
		const { jobId } = yield* enqueueSandboxScript(userId, { scriptId, lane: "interactive" });
		return requireCompletedSandboxValue(yield* pollSandboxResult(userId, jobId));
	});
