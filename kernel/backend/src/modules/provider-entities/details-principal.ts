import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { SandboxProviderId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import type { SandboxExecutionService } from "#modules/sandbox/service";

export const preRegisterProviderDetails = (
	services: {
		readonly sandbox: SandboxExecutionService["Service"];
		readonly pluginRuntime: PluginRuntimeResolver["Service"];
	},
	input: {
		readonly userId: UserId;
		readonly pluginId: string;
		readonly executionId: string;
		readonly providerId: SandboxProviderId;
		readonly accountGeneration: AccountGeneration;
	},
) =>
	services.pluginRuntime
		.resolveUserDetailsScript(input.userId, input.providerId)
		.pipe(
			Effect.flatMap((details) =>
				services.sandbox.preRegisterPluginWorkflow({
					scriptId: details.id,
					pluginId: input.pluginId,
					executingUserId: input.userId,
					executionId: input.executionId,
					accountGeneration: input.accountGeneration,
				}),
			),
		);
