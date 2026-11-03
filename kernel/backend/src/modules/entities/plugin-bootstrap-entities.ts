import { internalError, unknownToMessage } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { AutomationExecutionId, EntitySchemaSlug } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect, Layer, Schema } from "effect";

import { lifecycleActor, rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import {
	type PluginBootstrapDispatch,
	PluginBootstrapEntities,
	type PluginBootstrapEntitiesInput,
} from "#modules/plugins/installations/bootstrap-entities";

import { EntitiesService } from "./service";

export const PluginBootstrapEntitiesLive = Layer.effect(
	PluginBootstrapEntities,
	Effect.gen(function* () {
		const entities = yield* EntitiesService;
		const execution = yield* LifecycleExecution;
		const plansSchema = Schema.Array(LifecycleDispatchPlan);
		const ensure = Effect.fn("PluginBootstrapEntities.ensure")(
			function* (input: PluginBootstrapEntitiesInput) {
				const { initiator } = lifecycleActor({
					userId: input.userId,
					accountGeneration: input.accountGeneration,
				});
				const committed = yield* entities.commitUserEntities(
					input.userId,
					input.entities.map(({ entitySchemaSlug, ...entity }) => ({
						...entity,
						entitySchema: {
							owner: definitionOwner(input.pluginId),
							slug: EntitySchemaSlug.make(entitySchemaSlug),
						},
					})),
					{
						writeContext: null,
						...rootLifecycleCommand({
							initiator,
							lane: "background",
							source: "bootstrap",
							accountGeneration: input.accountGeneration,
							executionId: AutomationExecutionId.make(input.executionId),
							itemIdentity: `bootstrap:${input.installationId}:${input.entrySlug}`,
							occurredAt: DateTime.formatIso(DateTime.makeUnsafe(input.installedAt)),
						}),
					},
				);
				return yield* Schema.encodeEffect(plansSchema)(committed.flatMap((item) => item.dispatch));
			},
			Effect.mapError((error) =>
				internalError(`Plugin user bootstrap entities failed: ${unknownToMessage(error)}`),
			),
		);
		const dispatch = Effect.fn("PluginBootstrapEntities.dispatch")(
			function* (encoded: PluginBootstrapDispatch) {
				const plans = yield* Schema.decodeUnknownEffect(plansSchema)(encoded);
				const warnings = yield* execution.dispatch(plans);
				if (warnings.length > 0) {
					yield* Effect.logWarning(
						"User bootstrap entities completed with automation warnings",
					).pipe(Effect.annotateLogs({ warnings }));
				}
			},
			Effect.mapError((error) =>
				internalError(`Plugin user bootstrap dispatch failed: ${unknownToMessage(error)}`),
			),
		);
		return { ensure, dispatch };
	}),
);
