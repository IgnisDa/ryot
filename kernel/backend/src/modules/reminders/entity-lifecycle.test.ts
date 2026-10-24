import { assert, expect, layer } from "@effect/vitest";
import { EntityUserDataBadRequest } from "@ryot-app/contract/modules/entity-user-data/schemas";
import { AutomationExecutionId, EntityId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { and, eq, isNull } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { LifecyclePlannerServiceLive } from "#modules/automations/layer";
import {
	noLifecycleWorkLayer,
	withLifecycleDispatch,
} from "#modules/automations/lifecycle.test-support";
import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { AutomationRunRepository } from "#modules/automations/run-repository";
import { SignalEmissionService } from "#modules/automations/signal-service";
import { AutomationTriggerRepository } from "#modules/automations/trigger-repository";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import { kernelDefinitionSource } from "#modules/definitions/kernel-source";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EntityUserDataGraphRepository } from "#modules/entities/user-data/graph-repository";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import { DomainWriteChecksLive } from "#modules/entities/write-context";
import { EventsRepository } from "#modules/events/repository";
import { EventsService } from "#modules/events/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { NotificationDeliveryRepository } from "#modules/notifications/delivery-repository";
import { makeRevisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { DatabaseSession } from "#platform/db/session";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer, makeWorkflowEngine } from "#testing/effect";

import { ReminderEntityLifecycleLive } from "./entity-lifecycle";
import { reminderTestInput } from "./reminders.test-support";
import { RemindersRepository } from "./repository";
import { RemindersService } from "./service";

const execution = Layer.effectContext(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		return Context.make(
			LifecycleExecution,
			withLifecycleDispatch(
				{
					after: () => Effect.succeed([]),
					executePolicy: () => Effect.die("Unexpected policy"),
					skipQueuedPolicies: () => Effect.die("Unexpected policy"),
				},
				session,
			),
		);
	}),
);

const repositories = Layer.mergeAll(
	RemindersRepository.layer,
	MutationReceipts.layer,
	NotificationDeliveryRepository.layer,
	EntitiesRepository.layer,
	EntityUserDataGraphRepository.layer,
	RelationshipsRepository.layer,
	AutomationRunRepository.layer,
	AutomationTriggerRepository.layer,
	EventsRepository.layer,
);
const dependencies = SignalEmissionService.layer.pipe(
	Layer.provideMerge(LifecyclePlannerServiceLive.pipe(Layer.provide(noLifecycleWorkLayer))),
	Layer.provideMerge(execution),
	Layer.provideMerge(repositories),
	Layer.provideMerge(makeRevisionDatabaseLayer(4)),
	Layer.provideMerge(makeAppConfigLayer()),
);
const services = Layer.mergeAll(RemindersService.layer, EntityUserDataService.layer).pipe(
	Layer.provideMerge(ReminderEntityLifecycleLive),
	Layer.provide(
		Layer.mergeAll(
			EventsService.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						EventSchemaReader.layer,
						DomainWriteChecksLive,
						WorkflowExecutionNotifications.layer,
					),
				),
			),
			Layer.mock(RelationshipsService)({}),
		),
	),
	Layer.provideMerge(dependencies),
	Layer.provideMerge(Layer.succeed(WorkflowEngine, makeWorkflowEngine())),
);

const fixture = Effect.fnUntraced(function* (destinationPartNumbers: ReadonlyArray<number>) {
	const input = yield* reminderTestInput();
	const session = yield* DatabaseSession;
	const destinationRootId = EntityId.make(crypto.randomUUID());
	const sourcePartId = EntityId.make(crypto.randomUUID());
	const destinationParts = destinationPartNumbers.map((number) => ({
		number,
		id: EntityId.make(crypto.randomUUID()),
	}));
	const baseDefinitions = kernelDefinitionSource();
	const collection = baseDefinitions.entitySchemas.find(({ slug }) => slug === "collection");
	assert(collection);
	const sourceRootId = input.body.entityId;
	const sourcePartName = "Source part";

	yield* session.transaction(
		Effect.gen(function* () {
			yield* (yield* DefinitionRepository).replaceKernelDefinitions({
				...baseDefinitions,
				relationshipSchemas: [
					...baseDefinitions.relationshipSchemas,
					{
						slug: "parts",
						name: "Parts",
						pluginId: null,
						targetEntitySchemaSlug: "part",
						propertiesSchema: { fields: {} },
						sourceEntitySchemaSlug: "collection",
					},
				],
				entitySchemas: [
					{
						...collection,
						userState: {
							deniedOperations: [],
							children: [
								{ path: ["parts"], entitySchemaSlug: "part", identityProperties: ["number"] },
							],
						},
					},
					{
						icon: "box",
						slug: "part",
						name: "Part",
						pluginId: null,
						eventSchemas: [],
						propertiesSchema: {
							fields: { number: { type: "integer", label: "Number", description: "Part number" } },
						},
					},
				],
			});
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values([
						{
							name: "Destination",
							id: destinationRootId,
							userId: input.user.id,
							entitySchemaPluginId: null,
							entitySchemaSlug: "collection",
						},
						{
							id: sourcePartId,
							name: sourcePartName,
							userId: input.user.id,
							entitySchemaSlug: "part",
							properties: { number: 7 },
							entitySchemaPluginId: null,
						},
						...destinationParts.map(({ id, number }) => ({
							id,
							userId: input.user.id,
							properties: { number },
							entitySchemaSlug: "part",
							entitySchemaPluginId: null,
							name: `Destination part ${number}`,
						})),
					]),
			);
			yield* session.run((db) =>
				db
					.insert(tables.relationship)
					.values(
						[
							{ sourceEntityId: sourceRootId, targetEntityId: sourcePartId },
							...destinationParts.map(({ id }) => ({
								targetEntityId: id,
								sourceEntityId: destinationRootId,
							})),
						].map((relationship) =>
							Object.assign(relationship, {
								userId: null,
								properties: {},
								relationshipSchemaSlug: "parts",
								relationshipSchemaPluginId: null,
							}),
						),
					),
			);
		}),
	);

	const [destinationPart] = destinationParts;
	assert(destinationPart);
	const sourceReminder = yield* (yield* RemindersService).create(input.user, {
		...input.body,
		entityId: sourcePartId,
		parentEntityId: sourceRootId,
	});
	const destinationReminder = yield* (yield* RemindersService).create(input.user, {
		...input.body,
		entityId: destinationPart.id,
		message: "Destination reminder",
		parentEntityId: destinationRootId,
		idempotencyKey: `${input.body.idempotencyKey}-destination`,
		dueAt: DateTime.formatIso(
			DateTime.addDuration(DateTime.makeUnsafe(input.body.dueAt), "1 hour"),
		),
	});

	yield* session.run((db) =>
		db
			.delete(tables.relationship)
			.where(
				and(
					eq(tables.relationship.sourceEntityId, sourceRootId),
					eq(tables.relationship.targetEntityId, sourcePartId),
					eq(tables.relationship.relationshipSchemaSlug, "parts"),
					isNull(tables.relationship.userId),
				),
			),
	);
	const attachedSourceParts = yield* (yield* EntityUserDataGraphRepository).listChildren({
		pluginId: null,
		userId: input.user.id,
		entityId: sourceRootId,
		child: { path: ["parts"], entitySchemaSlug: "part", identityProperties: ["number"] },
	});
	expect(attachedSourceParts).toEqual([]);

	return {
		...input,
		sourceRootId,
		sourcePartId,
		sourceReminder,
		destinationParts,
		destinationRootId,
		destinationReminder,
	};
});

const lifecycleCommand = (input: Effect.Success<ReturnType<typeof reminderTestInput>>) =>
	rootLifecycleCommand({
		source: "api",
		lane: "interactive",
		occurredAt: input.body.submittedAt,
		itemIdentity: "detached-reminder-child-scope",
		initiator: { kind: "user", id: input.user.id },
		accountGeneration: input.user.accountGeneration,
		executionId: AutomationExecutionId.make(crypto.randomUUID()),
	});

layer(services)((test) => {
	test.effect("clears a detached child reminder through its source parent", () =>
		Effect.gen(function* () {
			const input = yield* fixture([7]);
			const repository = yield* RemindersRepository;
			const sourceBefore = yield* repository.findForUser(input.user.id, input.sourceReminder.id);
			const destinationBefore = yield* repository.findForUser(
				input.user.id,
				input.destinationReminder.id,
			);
			assert(sourceBefore);
			assert(destinationBefore);

			yield* (yield* EntityUserDataService).clearEntityUserData(
				input.user,
				input.sourceRootId,
				lifecycleCommand(input),
			);

			const sourceAfter = yield* repository.findForUser(input.user.id, input.sourceReminder.id);
			expect(sourceAfter).toMatchObject({
				message: null,
				entityId: null,
				state: "cancelled",
				parentEntityId: null,
				id: input.sourceReminder.id,
			});
			expect(sourceAfter?.removedAt).not.toBeNull();
			expect(sourceAfter?.dueAt).toBeNull();
			expect(yield* repository.findForUser(input.user.id, input.destinationReminder.id)).toEqual(
				destinationBefore,
			);
		}),
	);

	test.effect("moves a detached child reminder to its matching destination child", () =>
		Effect.gen(function* () {
			const input = yield* fixture([7]);
			const repository = yield* RemindersRepository;
			const sourceBefore = yield* repository.findForUser(input.user.id, input.sourceReminder.id);
			const destinationBefore = yield* repository.findForUser(
				input.user.id,
				input.destinationReminder.id,
			);
			assert(sourceBefore);
			assert(destinationBefore);
			const [destinationPart] = input.destinationParts;
			assert(destinationPart);

			yield* (yield* EntityUserDataService).mergeEntityUserData(
				input.user,
				{ mergeFrom: input.sourceRootId, mergeInto: input.destinationRootId },
				lifecycleCommand(input),
			);

			const moved = yield* repository.findForUser(input.user.id, input.sourceReminder.id);
			const destination = yield* repository.findForUser(
				input.user.id,
				input.destinationReminder.id,
			);
			expect(moved).toMatchObject({
				dueAt: sourceBefore.dueAt,
				id: input.sourceReminder.id,
				entityId: destinationPart.id,
				message: sourceBefore.message,
				parentEntityId: input.destinationRootId,
			});
			expect(destination).toMatchObject({
				entityId: destinationPart.id,
				dueAt: destinationBefore.dueAt,
				id: input.destinationReminder.id,
				message: destinationBefore.message,
				parentEntityId: input.destinationRootId,
			});
			expect(new Set([moved?.id, destination?.id])).toEqual(
				new Set([input.sourceReminder.id, input.destinationReminder.id]),
			);
		}),
	);

	for (const [caseName, destinationPartNumbers] of [
		["missing", [8]],
		["ambiguous", [7, 7]],
	] as const) {
		test.effect(`rejects ${caseName} child mapping before moving either reminder`, () =>
			Effect.gen(function* () {
				const input = yield* fixture(destinationPartNumbers);
				const repository = yield* RemindersRepository;
				const sourceBefore = yield* repository.findForUser(input.user.id, input.sourceReminder.id);
				const destinationBefore = yield* repository.findForUser(
					input.user.id,
					input.destinationReminder.id,
				);
				assert(sourceBefore);
				assert(destinationBefore);
				const exit = yield* (yield* EntityUserDataService)
					.mergeEntityUserData(
						input.user,
						{ mergeFrom: input.sourceRootId, mergeInto: input.destinationRootId },
						lifecycleCommand(input),
					)
					.pipe(Effect.exit);
				assertExitFails(
					exit,
					new EntityUserDataBadRequest({
						reason: {
							code: "child-mapping-conflict",
							entityIds: [input.sourcePartId],
							message:
								"Cannot merge 1 child item(s) without a unique matching destination: Source part (number=7). Refresh source data or correct the custom child names and identity fields, then try again. No data was moved.",
						},
					}),
				);
				expect(yield* repository.findForUser(input.user.id, input.sourceReminder.id)).toEqual(
					sourceBefore,
				);
				expect(yield* repository.findForUser(input.user.id, input.destinationReminder.id)).toEqual(
					destinationBefore,
				);
			}),
		);
	}
});
