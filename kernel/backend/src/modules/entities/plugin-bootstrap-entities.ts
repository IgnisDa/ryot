import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AutomationExecutionId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect, Layer } from "effect";

import { unexpected } from "#lib/domain/logged-rejection";
import { lifecycleActor, rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { ChangeSets } from "#modules/changes/service";
import {
	PluginBootstrapEntities,
	type PluginBootstrapEntitiesInput,
} from "#modules/plugins/installations/bootstrap-entities";

export const PluginBootstrapEntitiesLive = Layer.effect(
	PluginBootstrapEntities,
	Effect.gen(function* () {
		const changes = yield* ChangeSets;
		const ensure = Effect.fn("PluginBootstrapEntities.ensure")(
			function* (input: PluginBootstrapEntitiesInput) {
				const { initiator } = lifecycleActor({ userId: input.userId });
				yield* changes.commit(
					{
						userId: input.userId,
						entities: {
							ensures: input.entities.map(({ entitySchemaSlug, ...entity }) => ({
								...entity,
								entitySchema: {
									owner: definitionOwner(input.pluginId),
									slug: EntitySchemaSlug.make(entitySchemaSlug),
								},
							})),
						},
					},
					{
						writeContext: null,
						...rootLifecycleCommand({
							initiator,
							lane: "background",
							source: "bootstrap",
							accountUserId: input.accountUserId,
							executionId: AutomationExecutionId.make(input.executionId),
							itemIdentity: `bootstrap:${input.installationId}:${input.entrySlug}`,
							occurredAt: DateTime.formatIso(DateTime.makeUnsafe(input.installedAt)),
						}),
					},
				);
			},
			Effect.tapError((error) => Effect.logError("Plugin user bootstrap entities failed", error)),
			Effect.mapError(unexpected),
		);
		return { ensure };
	}),
);
