import type { DbError } from "@ryot-app/contract/errors";
import {
	AutomationExecutionId,
	type PluginId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Effect, Option } from "effect";

import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import type { ScriptRunInput } from "#modules/scripts/authorization/capabilities";

export const sandboxSubmissionCommand = Effect.fn("sandboxSubmissionCommand")(function* (
	input: ScriptRunInput,
	command: DomainLifecycleCommand,
	options: Parameters<ScriptHost["createEvents"]>[1],
	findInstallation: (userId: UserId, pluginId: PluginId) => Effect.Effect<string | null, DbError>,
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
	const installationId = yield* findInstallation(
		principal.subject.userId,
		principal.pluginRevision.id,
	).pipe(Effect.mapError((error) => ({ message: error.message })));
	if (!installationId) {
		return yield* Effect.fail({ message: "Write installation is unavailable" });
	}
	const executionId = AutomationExecutionId.make(
		`plugin-write-${sha256Base64Url(stableStringify([principal.subject.accountGeneration, installationId, principal.scriptSlug, command.itemIdentity, options.idempotencyKey]))}`,
	);
	return {
		...command,
		occurredAt: DateTime.formatIso(submittedAt.value),
		causation: { ...command.causation, executionId, rootExecutionId: executionId },
	};
});
