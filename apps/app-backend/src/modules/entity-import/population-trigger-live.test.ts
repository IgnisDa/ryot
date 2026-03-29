import { expect, it } from "@effect/vitest";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { EntityPopulationTrigger } from "#modules/entities/population-trigger";

import { EntityPopulationTriggerLive } from "./population-trigger-live";

it.effect("keeps the deterministic ID and exposes enqueue failure", () => {
	let executionId: string | undefined;
	const layer = EntityPopulationTriggerLive.pipe(
		Layer.provide(
			Layer.succeed(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) => {
						executionId = options.executionId;
						return Effect.die("enqueue failed");
					},
				}),
			),
		),
	);

	return Effect.gen(function* () {
		const trigger = yield* EntityPopulationTrigger;
		const exit = yield* Effect.exit(
			trigger.request({
				userId: null,
				externalId: "book-1",
				origin: { kind: "api" },
				entityId: EntityId.make("entity-1"),
				entitySchemaSlug: EntitySchemaSlug.make("book"),
				providerId: SandboxProviderId.make("provider-1"),
			}),
		);

		expect(executionId).toBe("populate-entity-1");
		expect(Exit.isFailure(exit)).toBe(true);
	}).pipe(Effect.provide(layer));
});
