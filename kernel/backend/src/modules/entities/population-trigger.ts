import type { SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	AutomationExecutionId,
	type EntityId,
	type EntitySchemaSlug,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";

import type { PopulationLevel } from "./providers/schemas";
import type { DomainLifecycleCommand } from "./write-context";

export type PopulationExecution = {
	readonly attempt?: string;
	readonly retryOf?: string;
	readonly inputHash?: string;
	readonly level: PopulationLevel;
	readonly manualRefresh?: boolean;
	readonly mode?: "ensure" | "refresh";
	readonly translationLanguage?: string;
};

export const populationRequestPin = (command: DomainLifecycleCommand) =>
	stableStringify([
		command.writeContext?.pluginRevision?.revisionId ?? null,
		command.writeContext?.pluginRevision?.configRevisionId ?? null,
	]);

export const entityPopulationExecutionId = (
	entityId: EntityId,
	accountUserId: null | UserId,
	execution: PopulationExecution,
) =>
	`enrich-populate-${sha256Base64Url(stableStringify([entityId, accountUserId, execution.level, execution.attempt ?? null]))}`;

export type PopulationRequest = {
	entityId: EntityId;
	externalId: string;
	userId: null | UserId;
	providerId: SandboxProviderId;
	execution: PopulationExecution;
	command: DomainLifecycleCommand;
	entitySchemaSlug: EntitySchemaSlug;
	entitySchemaPluginId: null | string;
};

export const userPopulationRequest = Effect.fnUntraced(function* (
	input: Omit<PopulationRequest, "command"> & {
		readonly initiator: UserId;
		readonly lane?: ExecutionLane;
		readonly accountUserId: UserId;
	},
) {
	const { initiator, accountUserId, lane = "interactive", ...request } = input;
	const executionId = entityPopulationExecutionId(input.entityId, accountUserId, input.execution);
	return {
		...request,
		command: {
			...rootLifecycleCommand({
				lane,
				source: "api",
				accountUserId,
				itemIdentity: executionId,
				initiator: { kind: "user", id: initiator },
				executionId: AutomationExecutionId.make(executionId),
				occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
			}),
			writeContext: null,
		},
	} satisfies PopulationRequest;
});

export class EntityPopulationTrigger extends Context.Service<
	EntityPopulationTrigger,
	{ request: (input: PopulationRequest) => Effect.Effect<boolean, SandboxRunError> }
>()("@ryot-app/kernel-backend/modules/entities/population-trigger/EntityPopulationTrigger") {}
