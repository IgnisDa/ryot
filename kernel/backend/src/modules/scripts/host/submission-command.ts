import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import type { submissionOptionsSchema } from "@ryot-app/plugin-backend-sdk/core";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, Layer, Option } from "effect";

import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import type { ScriptRunInput } from "#modules/scripts/authorization/capabilities";

export class SandboxSubmissionCommands extends Context.Service<SandboxSubmissionCommands>()(
	"SandboxSubmissionCommands",
	{
		make: Effect.gen(function* () {
			const runtime = yield* PluginRuntimeResolver;
			const commandFor = Effect.fn("SandboxSubmissionCommands.commandFor")(function* (
				input: ScriptRunInput,
				command: DomainLifecycleCommand,
				options: undefined | typeof submissionOptionsSchema.Type,
			) {
				if (options === undefined) {
					return command;
				}
				const { principal } = input;
				const submittedAt = DateTime.make(options.submittedAt);
				if (
					principal.subject.type !== "user" ||
					principal.pluginRevision === null ||
					Option.isNone(submittedAt)
				) {
					return yield* Effect.fail({
						message: "Stable writes require a user plugin and valid submission timestamp",
					});
				}
				const plugin = yield* runtime
					.findPluginAvailableToUser(principal.subject.userId, principal.pluginRevision.id)
					.pipe(Effect.mapError((error) => ({ message: error.message })));
				if (!plugin?.installationId) {
					return yield* Effect.fail({ message: "Write installation is unavailable" });
				}
				const executionId = AutomationExecutionId.make(
					`plugin-write-${sha256Base64Url(stableStringify([principal.subject.accountGeneration, plugin.installationId, principal.scriptSlug, command.itemIdentity, options.idempotencyKey]))}`,
				);
				return {
					...command,
					occurredAt: DateTime.formatIso(submittedAt.value),
					causation: { ...command.causation, executionId, rootExecutionId: executionId },
				};
			});
			return { commandFor };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
