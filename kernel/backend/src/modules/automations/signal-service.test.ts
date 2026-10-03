import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { AutomationExecutionId, EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Ref } from "effect";
import { describe } from "vitest";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import {
	installRevisionPackage,
	revisionPackage,
	revisionDatabaseLayer,
} from "#modules/plugins/revision.test-support";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SignalSchemasRepository } from "#modules/signals/signal-schemas-repository";

import { LifecyclePlannerServiceLive } from "./layer";
import { withLifecycleBatchPlanning, withLifecycleDispatch } from "./lifecycle.test-support";
import { SignalEmissionService } from "./signal-service";
import { AutomationTriggerRepository } from "./trigger-repository";

const owner = UserId.make("owner");
const recipient = UserId.make("recipient");
const subjectEntityId = EntityId.make("subject");
const command = (itemIdentity = "signal") =>
	rootLifecycleCommand({
		itemIdentity,
		source: "api",
		occurredAt: "2026-09-15T00:00:00.000Z",
		initiator: { id: owner, kind: "user" },
		executionId: AutomationExecutionId.make("emit"),
		accountGeneration: { userId: owner, token: "test-account-generation" },
	});
const input = {
	subjectEntityId,
	command: command(),
	schemaSlug: "fixture.signal",
	properties: { value: "first" },
	principal: { kind: "user", userId: owner },
} as const;

const privateSignalPackage = (slug: string) => {
	const value = revisionPackage(slug);
	return {
		...value,
		manifest: {
			...value.manifest,
			relationshipSchemas: value.manifest.relationshipSchemas.map((schema) =>
				Object.assign({}, schema, { slug: "shared-link" }),
			),
			hooks: value.manifest.hooks.map((hook) =>
				Object.assign({}, hook, {
					targets: hook.targets.map((target) =>
						target.resource === "signal"
							? { ...target, signalSchemaSlug: "shared.signal" }
							: target,
					),
				}),
			),
			signalSchemas: value.manifest.signalSchemas.map((schema) =>
				Object.assign({}, schema, {
					slug: "shared.signal",
					propertiesSchema: {
						fields: {
							value: { label: "Value", type: "string" as const, description: "Signal value" },
						},
					},
					audiencePolicy: {
						kind: "related_users" as const,
						subjectSide: "source" as const,
						relationshipSchemaSlug: "shared-link",
					},
				}),
			),
		},
	};
};

const setup = Effect.gen(function* () {
	yield* (yield* DatabaseSession).run((db) =>
		Effect.gen(function* () {
			const value = revisionPackage();
			const installed = yield* installRevisionPackage({
				...value,
				manifest: {
					...value.manifest,
					signalSchemas: value.manifest.signalSchemas.map((schema) =>
						Object.assign(schema, {
							propertiesSchema: {
								fields: {
									value: { label: "Value", type: "string" as const, description: "Signal value" },
								},
							},
							audiencePolicy: {
								kind: "related_users" as const,
								subjectSide: "source" as const,
								relationshipSchemaSlug: "fixture-link",
							},
						}),
					),
				},
			});
			yield* (yield* PluginInstallationRepository).create({
				config: {},
				sortOrder: 0,
				health: "ready",
				isHidden: false,
				userId: recipient,
				pluginId: installed.pluginId,
			});
			yield* db
				.insert(tables.entity)
				.values({
					name: "Subject",
					id: subjectEntityId,
					entitySchemaSlug: "fixture-entity",
					entitySchemaPluginId: installed.pluginId,
				});
			yield* db
				.insert(tables.relationship)
				.values(
					[owner, recipient].map((userId) => ({
						userId,
						sourceEntityId: subjectEntityId,
						targetEntityId: subjectEntityId,
						relationshipSchemaSlug: "fixture-link",
						relationshipSchemaPluginId: installed.pluginId,
					})),
				);
			yield* db
				.insert(tables.notificationSubscription)
				.values(
					[owner, recipient].map((userId) => ({
						userId,
						signalSchemaSlug: "fixture.signal",
						signalSchemaPluginId: installed.pluginId,
					})),
				);
		}),
	);
});

const dependencies = Layer.mergeAll(
	EntitiesRepository.layer,
	RelationshipsRepository.layer,
	RelationshipSchemasRepository.layer,
	SignalSchemasRepository.layer,
	AutomationTriggerRepository.layer,
);
const plannerLayer = LifecyclePlannerServiceLive.pipe(Layer.provide(makeAppConfigLayer()));
class StartedTriggers extends Context.Service<
	StartedTriggers,
	Effect.Effect<ReadonlyArray<string>>
>()("test/StartedTriggers") {}

const recordingExecutionLayer = Layer.effectContext(
	Effect.gen(function* () {
		const started = yield* Ref.make<ReadonlyArray<string>>([]);
		return Context.make(
			LifecycleExecution,
			withLifecycleDispatch({
				executePolicy: () => Effect.die("Signals cannot execute policies"),
				skipQueuedPolicies: () => Effect.die("Signals cannot skip policies"),
				after: ({ triggerId }) =>
					Ref.update(started, (all) => [...all, triggerId]).pipe(Effect.as([])),
			}),
		).pipe(Context.add(StartedTriggers, Ref.get(started)));
	}),
);

const planningFailure = new DbError({ message: "fail after planned writes" });
const failingPlannerLayer = Layer.effect(
	LifecyclePlanner,
	Effect.gen(function* () {
		const planner = yield* LifecyclePlanner;
		return withLifecycleBatchPlanning({
			plan: (request: Parameters<typeof planner.plan>[0]) =>
				planner.plan(request).pipe(Effect.andThen(Effect.fail(planningFailure))),
		});
	}),
).pipe(Layer.provide(plannerLayer));

const signalLayer = (planner: typeof plannerLayer = plannerLayer) =>
	SignalEmissionService.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(dependencies, planner, recordingExecutionLayer)),
		Layer.provideMerge(revisionDatabaseLayer),
	);

describe("Signal emission PostgreSQL", () => {
	layer(signalLayer())((test) => {
		test.effect(
			"keeps original recipients and pinned runs after audience changes, and rejects payload reuse",
			() =>
				Effect.gen(function* () {
					yield* setup;
					const service = yield* SignalEmissionService;
					yield* (yield* DatabaseSession).run((db) =>
						Effect.gen(function* () {
							const first = yield* service.emitSignal(input);
							expect(first.wasCreated).toBe(true);
							expect(
								(yield* db.select().from(tables.automationRun))
									.map((run) => run.executionUserId)
									.sort((left, right) => (left ?? "").localeCompare(right ?? "")),
							).toEqual([owner, recipient]);
							yield* db.delete(tables.relationship);
							yield* db.update(tables.notificationSubscription).set({ isActive: false });
							yield* db
								.update(tables.user)
								.set({ disabledAt: DateTime.toDate(yield* DateTime.now) })
								.where(eq(tables.user.id, recipient));
							expect(yield* service.emitSignal(input)).toEqual({ ...first, wasCreated: false });
							expect(
								(yield* db.select().from(tables.automationTriggerRecipient))
									.map((row) => row.userId)
									.sort(),
							).toEqual([owner, recipient]);
							expect(yield* db.select().from(tables.automationRun)).toHaveLength(2);
							assertExitFails(
								yield* service
									.emitSignal({ ...input, properties: { value: "different" } })
									.pipe(Effect.exit),
								new DbError({
									message: `Automation trigger identity conflict: ${first.triggerId}`,
								}),
							);
							expect(yield* yield* StartedTriggers).toEqual([first.triggerId, first.triggerId]);
						}),
					);
				}),
		);
	});
	layer(signalLayer())((test) => {
		test.effect("excludes disabled actors and recipients from new plans", () =>
			Effect.gen(function* () {
				yield* setup;
				yield* (yield* DatabaseSession).run((db) =>
					Effect.gen(function* () {
						yield* db.update(tables.user).set({ disabledAt: DateTime.toDate(yield* DateTime.now) });
						const result = yield* (yield* SignalEmissionService).emitSignal(input);
						expect(result.wasCreated).toBe(true);
						expect(yield* db.select().from(tables.automationTrigger)).toHaveLength(1);
						expect(yield* db.select().from(tables.automationTriggerRecipient)).toEqual([]);
						expect(yield* db.select().from(tables.automationRun)).toEqual([]);
					}),
				);
			}),
		);
	});
	layer(signalLayer())((test) => {
		test.effect("does not resolve a same-slug private signal through the recipient's plugin", () =>
			Effect.gen(function* () {
				const actorPlugin = yield* installRevisionPackage(privateSignalPackage("private-a"), owner);
				const recipientPlugin = yield* installRevisionPackage(
					privateSignalPackage("private-b"),
					recipient,
				);
				yield* (yield* DatabaseSession).run((db) =>
					Effect.gen(function* () {
						yield* db
							.insert(tables.entity)
							.values({
								name: "Subject",
								id: subjectEntityId,
								entitySchemaSlug: "private-a-entity",
								entitySchemaPluginId: actorPlugin.pluginId,
							});
						yield* db
							.insert(tables.relationship)
							.values(
								[owner, recipient].map((userId) => ({
									userId,
									sourceEntityId: subjectEntityId,
									targetEntityId: subjectEntityId,
									relationshipSchemaSlug: "shared-link",
									relationshipSchemaPluginId: actorPlugin.pluginId,
								})),
							);
						yield* db.insert(tables.notificationSubscription).values([
							{
								userId: owner,
								signalSchemaSlug: "shared.signal",
								signalSchemaPluginId: actorPlugin.pluginId,
							},
							{
								userId: recipient,
								signalSchemaSlug: "shared.signal",
								signalSchemaPluginId: recipientPlugin.pluginId,
							},
						]);

						const result = yield* (yield* SignalEmissionService).emitSignal({
							...input,
							schemaSlug: "shared.signal",
							command: command("private-signal"),
						});
						expect(result.wasCreated).toBe(true);
						expect(yield* db.select().from(tables.automationRun)).toMatchObject([
							{ executionUserId: owner, pluginId: actorPlugin.pluginId },
						]);
						expect(
							(yield* db.select().from(tables.automationTriggerRecipient))
								.map(({ userId }) => userId)
								.sort(),
						).toEqual([owner, recipient]);
						const [trigger] = yield* db.select().from(tables.automationTrigger);
						expect(trigger?.payload).toMatchObject({
							signalSchemaSlug: "shared.signal",
							signalSchemaPluginId: actorPlugin.pluginId,
						});
					}),
				);
			}),
		);
	});
	layer(signalLayer(failingPlannerLayer))((test) => {
		test.effect(
			"rolls back trigger, recipients and runs when planning fails, without starting execution",
			() =>
				Effect.gen(function* () {
					yield* setup;
					yield* (yield* DatabaseSession).run((db) =>
						Effect.gen(function* () {
							assertExitFails(
								yield* (yield* SignalEmissionService).emitSignal(input).pipe(Effect.exit),
								planningFailure,
							);
							expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
							expect(yield* db.select().from(tables.automationTriggerRecipient)).toEqual([]);
							expect(yield* db.select().from(tables.automationRun)).toEqual([]);
							expect(yield* yield* StartedTriggers).toEqual([]);
						}),
					);
				}),
		);
	});
});
