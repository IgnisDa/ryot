import { expect, it } from "@effect/vitest";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Exit, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { databaseLayer, makeWorkflowEngine } from "#lib/test-utils/effect";
import { EntityPopulationTrigger } from "#modules/entities/population-trigger";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntityPopulationTriggerLive } from "./population-trigger-live";

it.effect("keeps the deterministic ID and exposes enqueue failure", () => {
	let executionId: string | undefined;
	const layer = EntityPopulationTriggerLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.mock(PluginRuntimeResolver)({}),
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
		),
	);

	return Effect.gen(function* () {
		const trigger = yield* EntityPopulationTrigger;
		const exit = yield* Effect.exit(
			trigger.request({
				userId: null,
				externalId: "record-1",
				origin: { kind: "api" },
				entityId: EntityId.make("entity-1"),
				entitySchemaSlug: EntitySchemaSlug.make("record"),
				providerId: SandboxProviderId.make("provider-1"),
			}),
		);

		expect(executionId).toBe("populate-entity-1");
		expect(Exit.isFailure(exit)).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("does not enqueue user population for a disabled system provider", () => {
	let enqueued = false;
	const layer = EntityPopulationTriggerLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.mock(PluginRuntimeResolver)({
					findProviderAvailableToUser: () => Effect.succeed(null),
				}),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({ execute: () => Effect.sync(() => void (enqueued = true)) }),
				),
			),
		),
	);

	return Effect.gen(function* () {
		const trigger = yield* EntityPopulationTrigger;
		yield* trigger.request({
			externalId: "record-1",
			origin: { kind: "api" },
			userId: UserId.make("user-1"),
			entityId: EntityId.make("entity-1"),
			entitySchemaSlug: EntitySchemaSlug.make("record"),
			providerId: SandboxProviderId.make("provider-1"),
		});
		expect(enqueued).toBe(false);
	}).pipe(Effect.provide(layer));
});

const availableProvider = {
	name: "Provider",
	pluginId: "plugin-id",
	slug: "provider.slug",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	information: { source: "provider" },
	providerId: SandboxProviderId.make("provider-1"),
	rootEntitySchemaSlug: EntitySchemaSlug.make("record"),
};

const capturePopulationPayload = (pluginScope: "system" | "user") => {
	let payload: unknown;
	const layer = EntityPopulationTriggerLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.mock(PluginRuntimeResolver)({
					findProviderAvailableToUser: () =>
						Effect.succeed({ ...availableProvider, id: availableProvider.providerId, pluginScope }),
				}),
				Layer.succeed(
					WorkflowEngine,
					makeWorkflowEngine({
						execute: (_workflow, options) => {
							payload = options.payload;
							return Effect.void;
						},
					}),
				),
			),
		),
	);
	return { layer, getPayload: () => payload };
};

it.effect("keeps user-triggered system provider entities global", () => {
	const capture = capturePopulationPayload("system");
	return Effect.gen(function* () {
		const trigger = yield* EntityPopulationTrigger;
		yield* trigger.request({
			externalId: "record-1",
			origin: { kind: "api" },
			userId: UserId.make("user-1"),
			entityId: EntityId.make("entity-1"),
			entitySchemaSlug: EntitySchemaSlug.make("record"),
			providerId: SandboxProviderId.make("provider-1"),
		});
		expect(capture.getPayload()).toMatchObject({
			entityScope: { type: "global", userId: "user-1" },
		});
	}).pipe(Effect.provide(capture.layer));
});

it.effect("keeps user-triggered private provider entities user-owned", () => {
	const capture = capturePopulationPayload("user");
	return Effect.gen(function* () {
		const trigger = yield* EntityPopulationTrigger;
		yield* trigger.request({
			externalId: "record-1",
			origin: { kind: "api" },
			userId: UserId.make("user-1"),
			entityId: EntityId.make("entity-1"),
			entitySchemaSlug: EntitySchemaSlug.make("record"),
			providerId: SandboxProviderId.make("provider-1"),
		});
		expect(capture.getPayload()).toMatchObject({ entityScope: { type: "user", userId: "user-1" } });
	}).pipe(Effect.provide(capture.layer));
});
