import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { AutomationExecutionId, EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer } from "effect";
import { describe } from "vitest";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import {
	installRevisionPackage,
	revisionPackage,
	withRevisionDatabase,
} from "#modules/plugins/revision.test-support";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SignalSchemasRepository } from "#modules/signals/signal-schemas-repository";

import { withLifecycleDispatch } from "./lifecycle.test-support";
import { LifecyclePlannerLive } from "./planner";
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
	const db = yield* Database;
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
		userId: recipient,
		isDisabled: false,
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
});

const dependencies = Layer.mergeAll(
	EntitiesRepository.layer,
	RelationshipsRepository.layer,
	RelationshipSchemasRepository.layer,
	SignalSchemasRepository.layer,
	AutomationTriggerRepository.layer,
);
const plannerLayer = LifecyclePlannerLive.pipe(Layer.provide(makeAppConfigLayer()));
const executionLayer = (started: string[]) =>
	Layer.succeed(
		LifecycleExecution,
		withLifecycleDispatch({
			executePolicy: () => Effect.die("Signals cannot execute policies"),
			skipQueuedPolicies: () => Effect.die("Signals cannot skip policies"),
			after: ({ triggerId }) =>
				Effect.sync(() => {
					started.push(triggerId);
					return [];
				}),
		}),
	);

describe("Signal emission PostgreSQL", () => {
	it.effect(
		"keeps original recipients and pinned runs after audience changes, and rejects payload reuse",
		() => {
			const started: string[] = [];
			return withRevisionDatabase(
				Effect.gen(function* () {
					yield* setup;
					const service = yield* SignalEmissionService;
					const db = yield* Database;
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
						new DbError({ message: `Automation trigger identity conflict: ${first.triggerId}` }),
					);
					expect(started).toEqual([first.triggerId, first.triggerId]);
				}).pipe(
					Effect.provide(
						SignalEmissionService.layer.pipe(
							Layer.provide(Layer.mergeAll(dependencies, plannerLayer, executionLayer(started))),
						),
					),
				),
			);
		},
	);
	it.effect("excludes disabled actors and recipients from new plans", () => {
		return withRevisionDatabase(
			Effect.gen(function* () {
				yield* setup;
				const db = yield* Database;
				yield* db.update(tables.user).set({ disabledAt: DateTime.toDate(yield* DateTime.now) });
				const result = yield* (yield* SignalEmissionService).emitSignal(input);
				expect(result.wasCreated).toBe(true);
				expect(yield* db.select().from(tables.automationTrigger)).toHaveLength(1);
				expect(yield* db.select().from(tables.automationTriggerRecipient)).toEqual([]);
				expect(yield* db.select().from(tables.automationRun)).toEqual([]);
			}).pipe(
				Effect.provide(
					SignalEmissionService.layer.pipe(
						Layer.provide(Layer.mergeAll(dependencies, plannerLayer, executionLayer([]))),
					),
				),
			),
		);
	});
	it.effect("does not resolve a same-slug private signal through the recipient's plugin", () =>
		withRevisionDatabase(
			Effect.gen(function* () {
				const actorPlugin = yield* installRevisionPackage(privateSignalPackage("private-a"), owner);
				const recipientPlugin = yield* installRevisionPackage(
					privateSignalPackage("private-b"),
					recipient,
				);
				const db = yield* Database;
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
			}).pipe(
				Effect.provide(
					SignalEmissionService.layer.pipe(
						Layer.provide(Layer.mergeAll(dependencies, plannerLayer, executionLayer([]))),
					),
				),
			),
		),
	);
	it.effect(
		"rolls back trigger, recipients and runs when planning fails, without starting execution",
		() => {
			const started: string[] = [];
			const failure = new DbError({ message: "fail after planned writes" });
			const failingPlanner = Layer.effect(
				LifecyclePlanner,
				Effect.gen(function* () {
					const planner = yield* LifecyclePlanner;
					return {
						plan: (request: Parameters<typeof planner.plan>[0]) =>
							planner.plan(request).pipe(Effect.andThen(Effect.fail(failure))),
					};
				}),
			).pipe(Layer.provide(plannerLayer));
			return withRevisionDatabase(
				Effect.gen(function* () {
					yield* setup;
					const db = yield* Database;
					assertExitFails(
						yield* (yield* SignalEmissionService).emitSignal(input).pipe(Effect.exit),
						failure,
					);
					expect(yield* db.select().from(tables.automationTrigger)).toEqual([]);
					expect(yield* db.select().from(tables.automationTriggerRecipient)).toEqual([]);
					expect(yield* db.select().from(tables.automationRun)).toEqual([]);
					expect(started).toEqual([]);
				}).pipe(
					Effect.provide(
						SignalEmissionService.layer.pipe(
							Layer.provide(Layer.mergeAll(dependencies, failingPlanner, executionLayer(started))),
						),
					),
				),
			);
		},
	);
});
