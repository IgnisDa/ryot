import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
	AutomationExecutionId,
	type EntityId,
	type EntitySchemaSlug,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, DateTime, Effect } from "effect";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";

import type { PopulationLevel } from "./providers/schemas";
import type { DomainLifecycleCommand } from "./write-context";

export const POPULATION_UPGRADE_BUCKET_MILLISECONDS = 60 * 60 * 1_000;

export type PopulationExecution = {
	readonly attempt?: number;
	readonly level: PopulationLevel;
	readonly upgrade?: { readonly populatedAtMs: number; readonly hourBucket: number };
};

export const entityPopulationExecutionId = (
	entityId: EntityId,
	accountGeneration: AccountGeneration | null,
	execution: PopulationExecution,
) =>
	[
		`populate-${entityId}-${execution.level}`,
		...(accountGeneration === null ? [] : [accountGeneration.token]),
		...(execution.upgrade === undefined
			? []
			: [execution.upgrade.populatedAtMs, execution.upgrade.hourBucket]),
		...(execution.attempt === undefined ? [] : [execution.attempt]),
	].join("-");

export type PopulationRequest = {
	entityId: EntityId;
	externalId: string;
	userId: UserId | null;
	providerId: SandboxProviderId;
	execution: PopulationExecution;
	command: DomainLifecycleCommand;
	entitySchemaSlug: EntitySchemaSlug;
	entitySchemaPluginId: string | null;
};

export const userPopulationRequest = Effect.fnUntraced(function* (
	input: Omit<PopulationRequest, "command"> & {
		readonly initiator: UserId;
		readonly accountGeneration: AccountGeneration;
	},
) {
	const { initiator, accountGeneration, ...request } = input;
	const executionId = entityPopulationExecutionId(
		input.entityId,
		accountGeneration,
		input.execution,
	);
	return {
		...request,
		command: {
			...rootLifecycleCommand({
				source: "api",
				accountGeneration,
				lane: "interactive",
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
	{ request: (input: PopulationRequest) => Effect.Effect<boolean> }
>()("EntityPopulationTrigger") {}
