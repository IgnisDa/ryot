import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { DbError } from "@ryot-app/contract/errors";
import type {
	AutomationEntityDraft,
	AutomationPolicyInputProjection,
	AutomationPolicyOutput,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { CommittedChanges } from "@ryot-app/contract/modules/changes/change-set";
import { ChangeSet, ChangeSetEntityUpdate } from "@ryot-app/contract/modules/changes/change-set";
import type { ChangeSetEntityReference } from "@ryot-app/contract/modules/changes/references";
import { EventBadRequest } from "@ryot-app/contract/modules/events/schemas";
import type { PluginBeforeHook } from "@ryot-app/contract/modules/plugins/manifest";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	AutomationRunId,
	AutomationTriggerId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
	IntegrationId,
	PluginId,
	RelationshipSchemaSlug,
	SandboxScriptId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { KERNEL_NAMESPACE } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { automationInputSchema } from "@ryot-app/plugin-backend-sdk/automation";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { makeRecordingTracer, recordedStatements } from "@ryot-app/testing/recording-tracer";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq, inArray } from "drizzle-orm";
import {
	Context,
	Deferred,
	Effect,
	Fiber,
	Function,
	Layer,
	Ref,
	Schema,
	type Tracer,
} from "effect";

import {
	AutomationPolicyExecutionError,
	LifecyclePolicies,
	type PolicyRequest,
} from "#modules/automations/lifecycle/policies";
import { EventSchemaReader } from "#modules/definitions/event-schemas";
import notificationDefinition from "#modules/definitions/kernel-scripts/notification.sandbox";
import { Folds } from "#modules/derived-values/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { StatementLog } from "#modules/entities/statement-recording.test-support";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { EventMutations } from "#modules/events/mutations";
import { EventsRepository } from "#modules/events/repository";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { unrecorded } from "#modules/mutations/idempotency";
import { PluginCatalogInvalidatorLive } from "#modules/plugins/catalog/events";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import {
	installRevisionPackage,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/packages/types";
import { PluginUserSettingsWriter } from "#modules/plugins/preferences/user-settings-writer";
import {
	command,
	relationshipDatabaseLayer,
	userId,
} from "#modules/relationships/lifecycle.test-support";
import { ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { unavailableScriptCallsLayer } from "#modules/scripts/executions/calls.test-support";
import { ScriptChanges, scriptChangesFailure } from "#modules/scripts/executions/script-changes";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { DatabaseSession } from "#platform/db/session";
import { WriteTransaction } from "#platform/db/write-transaction";
import * as tables from "#schema/tables/combined";
import { workflowEngineTestLayer } from "#testing/effect";

import { CommitConflict } from "./conflict";
import { ChangeSetRejected } from "./authority";
import { changeSetsLayerWithNotificationSources, eventMove } from "./change-sets.test-support";
import { type Changes, eventChanges, eventCreateChanges, fromScriptChangeSet } from "./changes";
import { ScriptChangesLayer } from "./script-changes";
import { ChangeSets, type ScriptLifecycleCommand } from "./service";

type StagedWrites = {
	readonly events: number;
	readonly entities: number;
	readonly relationships: number;
};
class AtomicWriteObservation extends Context.Service<
	AtomicWriteObservation,
	{ readonly staged: Effect.Effect<null | StagedWrites> }
>()("@ryot-app/kernel-backend/modules/changes/service.test/AtomicWriteObservation") {}

const testLayer = (failAfterEvents: boolean, notificationSourcesOpen = true) => {
	const live = EventSchemaReader.layer.pipe(Layer.provideMerge(relationshipDatabaseLayer()));
	const mutations = Layer.unwrap(
		Effect.gen(function* () {
			const staged = yield* Ref.make<null | StagedWrites>(null);
			return Layer.merge(
				Layer.effect(
					EventMutations,
					Effect.gen(function* () {
						const original = yield* EventMutations.make;
						const session = yield* DatabaseSession;
						return EventMutations.of({
							...original,
							persistBatches: Effect.fn("AtomicCommandTest.persistBatches")(function* (
								transaction: WriteTransaction,
								input: Parameters<EventMutations["Service"]["persistBatches"]>[1],
							) {
								const result = yield* original.persistBatches(transaction, input);
								if (!failAfterEvents || input.batches.length === 0) {
									return result;
								}
								const rootId = input.batches[0]?.prepared.items[0]?.draft.entityId;
								assert(rootId);
								const entities = yield* session.run((db) =>
									db.select().from(tables.entity).where(eq(tables.entity.id, rootId)),
								);
								const relationships = yield* session.run((db) =>
									db
										.select()
										.from(tables.relationship)
										.where(eq(tables.relationship.sourceEntityId, rootId)),
								);
								const events = yield* session.run((db) =>
									db.select().from(tables.event).where(eq(tables.event.entityId, rootId)),
								);
								yield* Ref.set(staged, {
									events: events.length,
									entities: entities.length,
									relationships: relationships.length,
								});
								return yield* new DbError({ message: "Injected atomic commit failure" });
							}),
						});
					}),
				).pipe(Layer.provide(Folds.layer), Layer.provide(unavailableScriptCallsLayer)),
				Layer.succeed(AtomicWriteObservation, { staged: Ref.get(staged) }),
			);
		}),
	).pipe(Layer.provideMerge(live));
	return Layer.provideMerge(
		changeSetsLayerWithNotificationSources(notificationSourcesOpen).pipe(
			Layer.provideMerge(
				PluginUserSettingsWriter.layer.pipe(Layer.provide(PluginCatalogInvalidatorLive)),
			),
			Layer.provideMerge(mutations),
			Layer.provideMerge(workflowEngineTestLayer),
		),
		BunCrypto.layerSecureRandom,
	);
};

const commitUserCommand = (payload: {
	readonly input: ChangeSet;
	readonly command: ScriptLifecycleCommand;
}) =>
	Effect.flatMap(ChangeSets, (changes) =>
		changes.commitScript(
			payload.input,
			payload.command,
			unrecorded(Function.identity<CommittedChanges>),
		),
	).pipe(
		Effect.map(({ events, entityId }) => {
			assert(entityId);
			return { events, entityId };
		}),
	);

const fixture = Effect.fn("AtomicCommandTest.fixture")(function* (
	source: NormalizedPlugin = revisionPackage("atomic", "fixture", "record"),
) {
	const installed = yield* installRevisionPackage(source, userId);
	const session = yield* DatabaseSession;
	const runtime = yield* PluginRuntimeResolver;
	const providerSlug = source.manifest.providers[0]?.slug;
	assert(providerSlug);
	const provider = yield* runtime.findProviderAvailableToUserByReference(userId, {
		slug: providerSlug,
		owner: definitionOwner(installed.pluginId),
	});
	assert(provider);
	const script = yield* runtime.resolveUserDetailsScript(userId, provider.id);
	const accountUserId = yield* (yield* AccountAdmission.make).currentAccount(userId);
	const subject = { userId, type: "user" as const };
	const pin = yield* (yield* SandboxRepository.make).getScriptPin(script.id, undefined, subject);
	assert(pin?.pluginRevision);
	const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
	const [target] = yield* (yield* EntitiesRepository).insertEntities([
		{
			userId,
			scope: "user",
			properties: {},
			populatedAt: null,
			name: "Existing target",
			id: EntityId.make(yield* randomUuid),
			entitySchemaPluginId: installed.pluginId,
			entitySchemaSlug: EntitySchemaSlug.make("record"),
		},
	]);
	assert(target);
	const decoded = yield* Schema.decodeEffect(ChangeSet)({
		entity: {
			name: "Atomic root",
			entitySchemaSlug: "record",
			target: { kind: "create" },
			properties: { name: "Root" },
		},
		events: {
			changes: [
				{
					kind: "create",
					itemIdentity: "event",
					entity: { kind: "root" },
					eventSchemaSlug: "changed",
					properties: { value: "Saved" },
				},
			],
		},
		relationships: {
			upserts: [
				{
					properties: {},
					propertiesMode: "merge",
					source: { kind: "root" },
					relationshipSchemaSlug: "atomic-link",
					target: { kind: "existing", entityId: target.id },
				},
			],
		},
	});
	const { entity, events } = decoded;
	const upserts = decoded.relationships?.upserts;
	assert(entity && events && upserts);
	const input = { ...decoded, entity, events, relationships: { upserts } };
	return {
		input,
		session,
		providerId: provider.id,
		pluginId: installed.pluginId,
		revisionId: installed.revisionId,
		command: { ...command(yield* randomUuid), accountUserId, writeContext: principal },
	};
});

const eventCreate = (entity: ChangeSetEntityReference) => ({
	changes: [
		{
			entity,
			itemIdentity: "event",
			kind: "create" as const,
			eventSchemaSlug: "changed",
			properties: { value: "Saved" },
		},
	],
});

const policyPackage = (
	inputProjection: AutomationPolicyInputProjection,
	targets: (typeof PluginBeforeHook.Type)["targets"],
	batchFrequency?: "once-per-subject",
) => {
	const source = revisionPackage("atomic", "fixture", "record");
	const automation = source.scripts.find(({ metadata }) => metadata.kind === "automation");
	assert(automation?.metadata.kind === "automation");
	const policy = {
		...automation,
		slug: "atomic.guard",
		contentHash: "atomic-guard",
		entry: "backend/policy.sandbox.ts",
		metadata: {
			...automation.metadata,
			inputProjection,
			capabilities: [],
			slug: "atomic.guard",
			automationType: "policy" as const,
		},
	};
	return {
		...source,
		scripts: [...source.scripts, policy],
		manifest: {
			...source.manifest,
			scripts: [...source.manifest.scripts, { ...policy.metadata, entry: policy.entry }],
			hooks: [
				...source.manifest.hooks,
				{
					name: "Guard",
					slug: "atomic.guard",
					scriptSlug: policy.slug,
					stage: "before" as const,
					...(batchFrequency ? { batchFrequency } : {}),
					targets,
				},
			],
		},
	};
};

/** Renames a created entity, and sets a created event's value to its entity's name as policies see it. */
const renamingRoot = (
	request: PolicyRequest["items"][number]["request"],
	references: Readonly<Record<string, AutomationEntityDraft>>,
): AutomationPolicyOutput => {
	if (request.operation !== "create") {
		return { action: "allow" };
	}
	if (request.resource === "entity") {
		return {
			action: "transform",
			patch: {
				resource: "entity",
				draft: { properties: { remove: [], set: { name: "Transformed" } } },
			},
		};
	}
	if (request.resource === "event") {
		const value = references[request.draft.entityId]?.properties["name"] ?? null;
		return {
			action: "transform",
			patch: { resource: "event", draft: { properties: { remove: [], set: { value } } } },
		};
	}
	return { action: "allow" };
};

const guardedPackage = (
	batchFrequency?: "once-per-subject",
	operations: ReadonlyArray<"create" | "update" | "delete"> = ["create"],
) =>
	policyPackage(
		{ event: { properties: ["value"] } },
		operations.map((operation) => ({
			operation,
			resource: "event" as const,
			eventSchemaSlug: "changed",
			entitySchemaSlug: "record",
		})),
		batchFrequency,
	);

layer(testLayer(false))((test) => {
	test.effect(
		"gives event policies the root entity as its entity policies transformed it",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture(
					policyPackage({ entity: { properties: ["name"] }, event: { properties: ["value"] } }, [
						{ resource: "entity", operation: "create", entitySchemaSlug: "record" },
						{
							resource: "event",
							operation: "create",
							eventSchemaSlug: "changed",
							entitySchemaSlug: "record",
						},
					]),
				);
				const { match } = yield* LifecyclePolicies;
				const changeSets = yield* ChangeSets.make.pipe(
					Effect.provideService(
						LifecyclePolicies,
						LifecyclePolicies.of({
							match,
							run: ({ request: { items, references } }) =>
								Effect.succeed({
									items: items.map(({ request, itemIdentity }) => ({
										itemIdentity,
										decision: renamingRoot(request, references),
									})),
								}),
						}),
					),
				);
				const { entityId } = yield* changeSets.commitScript(
					{ ...input.input, relationships: {} },
					input.command,
					unrecorded(Function.identity<CommittedChanges>),
				);
				assert(entityId);
				expect((yield* (yield* EntitiesRepository).getById(entityId))?.properties).toEqual({
					name: "Transformed",
				});
				expect(
					yield* input.session.run((db) =>
						db
							.select({ properties: tables.event.properties })
							.from(tables.event)
							.where(eq(tables.event.entityId, entityId)),
					),
				).toEqual([{ properties: { value: "Transformed" } }]);
			}),
		testTimeout,
	);

	test.effect(
		"reads the user's plugins once per phase and the writer's configuration lock and pin once per commit",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const log = yield* StatementLog;
				const spans: Tracer.Span[] = [];
				const transactions = (yield* log.transactions).length;
				for (const item of ["first", "second"]) {
					yield* commitUserCommand({
						input: input.input,
						command: {
							...command(`${input.command.causation.executionId}:${item}`),
							writeContext: input.command.writeContext,
							accountUserId: input.command.accountUserId,
						},
					}).pipe(Effect.withTracer(makeRecordingTracer(spans)));
				}
				const statements = recordedStatements(spans);
				expect({
					userPlugins: statements.filter((text) => text.includes("from plugin_installation i")),
					pins: statements.filter((text) =>
						text.includes('from "plugin_revision" inner join "plugin"'),
					),
					configLocks: (yield* log.transactions)
						.slice(transactions)
						.flat()
						.filter(({ params }) =>
							params.some(
								(param) => typeof param === "string" && param.startsWith("plugin-config:"),
							),
						),
				}).toMatchObject({
					pins: { length: 2 },
					userPlugins: { length: 4 },
					configLocks: { length: 2 },
				});
			}),
		testTimeout,
	);

	test.effect(
		"resolves the writer's execution authority only in the commit transaction",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const spans: Tracer.Span[] = [];
				yield* commitUserCommand({ input: input.input, command: input.command }).pipe(
					Effect.withTracer(makeRecordingTracer(spans)),
				);
				const within = (span: Tracer.AnySpan, name: string): boolean =>
					span._tag === "Span" &&
					(span.name === name || (span.parent._tag === "Some" && within(span.parent.value, name)));
				const resolves = spans.filter(({ name }) => name === "SandboxExecutionAuthority.resolve");
				expect(
					resolves.map((span) => [
						within(span, "ChangeSets.prepareChanges"),
						within(span, "EventMutations.prepare"),
					]),
				).toEqual([[false, true]]);
				expect(spans.filter(({ name }) => name === "SandboxRepository.getScriptPin")).toHaveLength(
					1,
				);
			}),
		testTimeout,
	);

	test.effect(
		"runs before policies without persisting automation triggers, runs or attempts",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture(guardedPackage());
				const automationRows = input.session.run((db) =>
					Effect.all([
						db.select({ id: tables.automationTrigger.id }).from(tables.automationTrigger),
						db.select({ id: tables.automationRun.id }).from(tables.automationRun),
						db.select({ id: tables.automationRunAttempt.id }).from(tables.automationRunAttempt),
					]),
				);
				const before = yield* automationRows;
				const spans: Tracer.Span[] = [];
				yield* commitUserCommand({ input: input.input, command: input.command }).pipe(
					Effect.withTracer(makeRecordingTracer(spans)),
				);
				expect(spans.filter(({ name }) => name === "LifecyclePolicies.run")).toHaveLength(1);
				expect(yield* automationRows).toEqual(before);
			}),
		testTimeout,
	);

	test.effect(
		"runs a once-per-subject policy once per subject across a change set of more than 50 events",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture(guardedPackage("once-per-subject"));
				const [relation] = input.input.relationships.upserts;
				assert(relation?.target.kind === "existing");
				const target = relation.target;
				const creates = Array.from({ length: 101 }, (_, index) => ({
					kind: "create" as const,
					eventSchemaSlug: "changed",
					itemIdentity: `event-${index}`,
					properties: { value: `Saved ${index}` },
					entity: index % 2 === 0 ? { kind: "root" as const } : target,
				}));
				const spans: Tracer.Span[] = [];
				const committed = yield* commitUserCommand({
					command: input.command,
					input: { ...input.input, events: { changes: creates } },
				}).pipe(Effect.withTracer(makeRecordingTracer(spans)));
				expect(committed.events).toHaveLength(101);
				expect(spans.filter(({ name }) => name === "LifecyclePolicies.run")).toHaveLength(2);
			}),
		testTimeout,
	);

	test.effect(
		"commits events on existing entities without a root entity and rejects root references",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const [relation] = input.input.relationships.upserts;
				assert(relation?.target.kind === "existing");
				const target = relation.target.entityId;
				const commands = yield* ChangeSets;
				const committed = yield* commands.commitScript(
					{ events: eventCreate({ kind: "existing", entityId: target }) },
					input.command,
					unrecorded(Function.identity<CommittedChanges>),
				);
				expect(committed.entityId).toBeUndefined();
				expect(committed.events.map(({ itemIdentity }) => itemIdentity)).toEqual(["event"]);
				const rejected = yield* Effect.flip(
					commands.commitScript(
						{ events: eventCreate({ kind: "root" }) },
						{
							...input.command,
							...command(yield* randomUuid),
							writeContext: input.command.writeContext,
							accountUserId: input.command.accountUserId,
						},
						unrecorded(Function.identity<CommittedChanges>),
					),
				);
				expect(rejected).toEqual(new EventBadRequest({ reason: { code: "root-entity-required" } }));
			}),
		testTimeout,
	);

	test.effect(
		"allows event preparation to overlap an atomic subject commit without inverted locks",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const initial = yield* commitUserCommand({ input: input.input, command: input.command });
				const source = initial.events[0];
				assert(source);
				const entities = yield* EntitiesRepository;
				const events = yield* EventsRepository;
				const subjectLocked = yield* Deferred.make<void>();
				const snapshotRead = yield* Deferred.make<void>();
				const commit = yield* Effect.forkScoped(
					input.session.transaction(
						Effect.gen(function* () {
							yield* entities.getMutationEntities([initial.entityId], true);
							yield* Deferred.succeed(subjectLocked, undefined);
							yield* Deferred.await(snapshotRead);
							yield* events.lockEventRows({ userId, eventIds: [source.eventId] });
						}),
					),
				);
				yield* Deferred.await(subjectLocked);
				const prepare = yield* Effect.forkScoped(
					input.session.transaction(
						Effect.gen(function* () {
							const snapshot = yield* events.getEventSnapshot({ userId, eventId: source.eventId });
							assert(snapshot);
							yield* Deferred.succeed(snapshotRead, undefined);
							yield* entities.lockEntityReferencesByIds([initial.entityId]);
							return snapshot.snapshot.properties;
						}),
					),
				);
				yield* Fiber.join(commit);
				expect(yield* Fiber.join(prepare)).toEqual({ value: "Saved" });
			}).pipe(Effect.scoped),
		testTimeout,
	);

	test.effect(
		"retains source order across derived event creation, repair and explicit reset",
		() =>
			Effect.gen(function* () {
				const fixtureInput = yield* fixture();
				const initial = yield* commitUserCommand({
					input: fixtureInput.input,
					command: fixtureInput.command,
				});
				const source = initial.events[0];
				assert(source);
				const execute = (events: ChangeSet["events"]) =>
					commitUserCommand({
						input: { ...fixtureInput.input, events, relationships: {} },
						command: {
							...fixtureInput.command,
							...command(crypto.randomUUID()),
							writeContext: fixtureInput.command.writeContext,
							accountUserId: fixtureInput.command.accountUserId,
						},
					});
				const derived = yield* execute({
					changes: [
						{
							kind: "create",
							itemIdentity: "derived",
							eventSchemaSlug: "changed",
							properties: { value: "Derived" },
							entity: { kind: "existing", entityId: initial.entityId },
							orderAfter: { suffix: "derived", eventId: source.eventId },
						},
					],
				});
				const output = derived.events[0];
				assert(output);
				const [row] = yield* fixtureInput.session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.id, output.eventId)),
				);
				const [sourceRow] = yield* fixtureInput.session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.id, source.eventId)),
				);
				assert(row && sourceRow);
				expect(row.orderKey).toBe(`${source.eventId}~derived`);
				expect(row.orderCreatedAt?.toISOString()).toBe(sourceRow.createdAt.toISOString());
				yield* execute({
					changes: [
						{
							kind: "update",
							itemIdentity: "repair",
							item: {
								eventId: output.eventId,
								patch: {
									occurredAt: "2026-01-02T00:00:00.000Z",
									orderAfter: { suffix: "repaired", eventId: source.eventId },
								},
							},
						},
					],
				});
				const [repaired] = yield* fixtureInput.session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.id, output.eventId)),
				);
				expect(repaired?.orderKey).toBe(`${source.eventId}~repaired`);
				yield* execute({
					changes: [
						{
							kind: "update",
							itemIdentity: "explicit",
							item: { eventId: output.eventId, patch: { orderAfter: null } },
						},
					],
				});
				const [explicit] = yield* fixtureInput.session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.id, output.eventId)),
				);
				expect(explicit).toMatchObject({
					orderKey: null,
					orderCreatedAt: null,
					createdAt: row.createdAt,
				});
			}),
		testTimeout,
	);

	for (const mutation of ["insert", "update", "delete"] as const) {
		test.effect(
			`rejects an atomic command when its source-event baseline changed by ${mutation}`,
			() =>
				Effect.gen(function* () {
					const input = yield* fixture();
					const original = yield* commitUserCommand({ input: input.input, command: input.command });
					const source = original.events[0];
					assert(source);
					const nextCommand = () => ({
						...input.command,
						...command(crypto.randomUUID()),
						writeContext: input.command.writeContext,
						accountUserId: input.command.accountUserId,
					});
					let changes: NonNullable<ChangeSet["events"]>["changes"] = [];
					if (mutation === "update") {
						changes = [
							{
								kind: "update",
								itemIdentity: "corrected",
								item: {
									eventId: source.eventId,
									patch: { properties: { remove: [], set: { value: "Corrected" } } },
								},
							},
						];
					}
					if (mutation === "delete") {
						changes = [{ kind: "delete", itemIdentity: "removed", eventId: source.eventId }];
					}
					const racingInput = yield* Schema.decodeEffect(ChangeSet)({
						...input.input,
						relationships: {},
						events: {
							changes:
								mutation === "insert"
									? [
											{
												kind: "create",
												itemIdentity: "inserted",
												eventSchemaSlug: "changed",
												properties: { value: "New" },
												entity: { kind: "existing", entityId: original.entityId },
											},
										]
									: changes,
						},
					});
					yield* commitUserCommand({ input: racingInput, command: nextCommand() });
					const staleInput = yield* Schema.decodeEffect(ChangeSet)({
						...input.input,
						relationships: {},
						entity: { ...input.input.entity, name: "Must not commit" },
						events: { changes: [], baselines: [{ revision: 1, entityId: original.entityId }] },
					});
					assertExitFails(
						yield* Effect.exit(commitUserCommand({ input: staleInput, command: nextCommand() })),
						new CommitConflict({ reason: { code: "entity-stale", entityId: original.entityId } }),
					);
					const partial = yield* input.session.run((db) =>
						db
							.select({ id: tables.entity.id })
							.from(tables.entity)
							.where(
								and(
									eq(tables.entity.entitySchemaPluginId, input.pluginId),
									eq(tables.entity.name, "Must not commit"),
								),
							),
					);
					expect(partial).toEqual([]);
				}),
			testTimeout,
		);
	}

	test.effect(
		"checks source and evidence event baselines together and atomically",
		() =>
			Effect.gen(function* () {
				const matching = yield* fixture();
				const original = yield* commitUserCommand({
					input: matching.input,
					command: matching.command,
				});
				const matchingRelationship = matching.input.relationships.upserts[0];
				assert(matchingRelationship);
				assert(matchingRelationship.target.kind === "existing");
				const matchingEvidenceId = matchingRelationship.target.entityId;
				const eventRows = yield* EventsRepository;
				const matchingBaselines = [
					{
						entityId: original.entityId,
						revision: yield* eventRows.getScopeRevision({
							userId,
							entityId: original.entityId,
							eventSchemaPluginId: matching.pluginId,
						}),
					},
					{
						entityId: matchingEvidenceId,
						revision: yield* eventRows.getScopeRevision({
							userId,
							entityId: matchingEvidenceId,
							eventSchemaPluginId: matching.pluginId,
						}),
					},
				];
				expect(matchingBaselines[1]?.revision).toBe(0);
				const matchingInput = yield* Schema.decodeEffect(ChangeSet)({
					...matching.input,
					relationships: {},
					events: { ...matching.input.events, baselines: matchingBaselines },
				});
				const matchingResult = yield* commitUserCommand({
					input: matchingInput,
					command: {
						...matching.command,
						...command(yield* randomUuid),
						writeContext: matching.command.writeContext,
						accountUserId: matching.command.accountUserId,
					},
				});
				expect(matchingResult.events).toHaveLength(1);

				for (const mutatedScope of ["source", "evidence"] as const) {
					const input = yield* fixture();
					const source = yield* commitUserCommand({ input: input.input, command: input.command });
					const relationship = input.input.relationships.upserts[0];
					assert(relationship);
					assert(relationship.target.kind === "existing");
					const evidenceId = relationship.target.entityId;
					const baselines = [
						{
							entityId: source.entityId,
							revision: yield* eventRows.getScopeRevision({
								userId,
								entityId: source.entityId,
								eventSchemaPluginId: input.pluginId,
							}),
						},
						{
							entityId: evidenceId,
							revision: yield* eventRows.getScopeRevision({
								userId,
								entityId: evidenceId,
								eventSchemaPluginId: input.pluginId,
							}),
						},
					];
					expect(baselines[1]?.revision).toBe(0);
					const changedEntityId = mutatedScope === "source" ? source.entityId : evidenceId;
					const racingInput = yield* Schema.decodeEffect(ChangeSet)({
						...input.input,
						relationships: {},
						events: {
							changes: [
								{
									kind: "create",
									eventSchemaSlug: "changed",
									properties: { value: "Raced" },
									itemIdentity: `racing-${mutatedScope}`,
									entity: { kind: "existing", entityId: changedEntityId },
								},
							],
						},
					});
					yield* commitUserCommand({
						input: racingInput,
						command: {
							...input.command,
							...command(yield* randomUuid),
							writeContext: input.command.writeContext,
							accountUserId: input.command.accountUserId,
						},
					});

					const sourceEvidenceBefore = yield* input.session.run((db) =>
						db
							.select()
							.from(tables.entity)
							.where(inArray(tables.entity.id, [source.entityId, evidenceId]))
							.orderBy(tables.entity.id),
					);
					const committedBefore = {
						events: yield* input.session.run((db) =>
							db
								.select({ id: tables.event.id })
								.from(tables.event)
								.where(eq(tables.event.eventSchemaPluginId, input.pluginId))
								.orderBy(tables.event.id),
						),
						entities: yield* input.session.run((db) =>
							db
								.select({ id: tables.entity.id })
								.from(tables.entity)
								.where(eq(tables.entity.entitySchemaPluginId, input.pluginId))
								.orderBy(tables.entity.id),
						),
						relationships: yield* input.session.run((db) =>
							db
								.select({ id: tables.relationship.id })
								.from(tables.relationship)
								.where(eq(tables.relationship.relationshipSchemaPluginId, input.pluginId))
								.orderBy(tables.relationship.id),
						),
					};
					const staleInput = yield* Schema.decodeEffect(ChangeSet)({
						...input.input,
						events: { ...input.input.events, baselines },
						entity: { ...input.input.entity, name: "Must not commit" },
					});
					assertExitFails(
						yield* Effect.exit(
							commitUserCommand({
								input: staleInput,
								command: {
									...input.command,
									...command(yield* randomUuid),
									writeContext: input.command.writeContext,
									accountUserId: input.command.accountUserId,
								},
							}),
						),
						new CommitConflict({ reason: { code: "entity-stale", entityId: changedEntityId } }),
					);
					const sourceEvidenceAfter = yield* input.session.run((db) =>
						db
							.select()
							.from(tables.entity)
							.where(inArray(tables.entity.id, [source.entityId, evidenceId]))
							.orderBy(tables.entity.id),
					);
					const committedAfter = {
						events: yield* input.session.run((db) =>
							db
								.select({ id: tables.event.id })
								.from(tables.event)
								.where(eq(tables.event.eventSchemaPluginId, input.pluginId))
								.orderBy(tables.event.id),
						),
						entities: yield* input.session.run((db) =>
							db
								.select({ id: tables.entity.id })
								.from(tables.entity)
								.where(eq(tables.entity.entitySchemaPluginId, input.pluginId))
								.orderBy(tables.entity.id),
						),
						relationships: yield* input.session.run((db) =>
							db
								.select({ id: tables.relationship.id })
								.from(tables.relationship)
								.where(eq(tables.relationship.relationshipSchemaPluginId, input.pluginId))
								.orderBy(tables.relationship.id),
						),
					};
					expect(sourceEvidenceAfter).toEqual(sourceEvidenceBefore);
					expect(committedAfter).toEqual(committedBefore);
				}
			}),
		testTimeout,
	);

	test.effect(
		"event-only commands keep entity and data revisions unchanged",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const original = yield* commitUserCommand({ input: input.input, command: input.command });
				const [rootBefore] = yield* input.session.run((db) =>
					db
						.select({
							name: tables.entity.name,
							updatedAt: tables.entity.updatedAt,
							properties: tables.entity.properties,
						})
						.from(tables.entity)
						.where(eq(tables.entity.id, original.entityId)),
				);
				assert(rootBefore);
				expect(rootBefore.name).toBe(input.input.entity.name);
				expect(rootBefore.properties).toEqual(input.input.entity.properties);
				const eventRows = yield* EventsRepository;
				const evidenceRevisionBefore = yield* eventRows.getScopeRevision({
					userId,
					entityId: original.entityId,
					eventSchemaPluginId: input.pluginId,
				});
				const executeEventOnly = (itemIdentity: string) =>
					Effect.gen(function* () {
						const commandInput = yield* Schema.decodeEffect(ChangeSet)({
							...input.input,
							relationships: {},
							events: {
								changes: [
									{
										itemIdentity,
										kind: "create",
										eventSchemaSlug: "changed",
										properties: { value: itemIdentity },
										entity: { kind: "existing", entityId: original.entityId },
									},
								],
							},
							entity: {
								...input.input.entity,
								target: {
									kind: "update",
									entityId: original.entityId,
									expected: {
										name: input.input.entity.name,
										properties: input.input.entity.properties,
										updatedAt: rootBefore.updatedAt.toISOString(),
									},
								},
							},
						});
						return yield* commitUserCommand({
							input: commandInput,
							command: {
								...input.command,
								...command(yield* randomUuid),
								writeContext: input.command.writeContext,
								accountUserId: input.command.accountUserId,
							},
						});
					});
				const first = yield* executeEventOnly("checkpoint-one");
				const evidenceRevisionAfterFirst = yield* eventRows.getScopeRevision({
					userId,
					entityId: original.entityId,
					eventSchemaPluginId: input.pluginId,
				});
				expect(evidenceRevisionAfterFirst).toBe(evidenceRevisionBefore + 1);
				const second = yield* executeEventOnly("checkpoint-two");
				const evidenceRevisionAfterSecond = yield* eventRows.getScopeRevision({
					userId,
					entityId: original.entityId,
					eventSchemaPluginId: input.pluginId,
				});
				expect(first.events).toHaveLength(1);
				expect(second.events).toHaveLength(1);
				expect(evidenceRevisionAfterSecond).toBe(evidenceRevisionAfterFirst + 1);
				const [rootAfter] = yield* input.session.run((db) =>
					db
						.select({
							name: tables.entity.name,
							updatedAt: tables.entity.updatedAt,
							properties: tables.entity.properties,
						})
						.from(tables.entity)
						.where(eq(tables.entity.id, original.entityId)),
				);
				expect(rootAfter).toEqual(rootBefore);
			}),
		testTimeout,
	);

	test.effect(
		"commits a new entity, relationship, and event together and replays its result",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const result = yield* commitUserCommand({ input: input.input, command: input.command });
				expect(result.events).toHaveLength(1);
				expect(yield* commitUserCommand({ input: input.input, command: input.command })).toEqual(
					result,
				);
				const entities = yield* input.session.run((db) =>
					db.select().from(tables.entity).where(eq(tables.entity.id, result.entityId)),
				);
				const relationships = yield* input.session.run((db) =>
					db
						.select()
						.from(tables.relationship)
						.where(eq(tables.relationship.sourceEntityId, result.entityId)),
				);
				const events = yield* input.session.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.entityId, result.entityId)),
				);
				expect(entities).toMatchObject([{ name: "Atomic root", properties: { name: "Root" } }]);
				expect(relationships).toHaveLength(1);
				expect(events).toMatchObject([
					{ id: result.events[0]?.eventId, properties: { value: "Saved" } },
				]);
			}),
		testTimeout,
	);
});

layer(testLayer(true))((test) => {
	test.effect(
		"rolls an entity data merge back with its event moves after a late commit failure",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commit(
					{ entity: input.input.entity, relationships: input.input.relationships },
					input.command,
				);
				assert(root.entityId);
				const target = targetOf(input);
				yield* seedEvent(input, root.entityId, undefined, "merged-event");
				assertExitFails(
					yield* Effect.exit(
						commit(
							{
								entities: {
									merges: [
										{ mergeInto: target, mergeFrom: root.entityId, entitySchemaSlug: "record" },
									],
								},
							},
							nextCommand(input),
						),
					),
					new DbError({ message: "Injected atomic commit failure" }),
				);
				expect((yield* (yield* AtomicWriteObservation).staged)?.events).toBe(1);
				expect(yield* eventRow(input, "merged-event")).toMatchObject({ entityId: root.entityId });
				expect(
					yield* input.session.run((db) =>
						db
							.select({ source: tables.relationship.sourceEntityId })
							.from(tables.relationship)
							.where(eq(tables.relationship.relationshipSchemaPluginId, input.pluginId)),
					),
				).toEqual([{ source: root.entityId }]);
			}),
		testTimeout,
	);

	test.effect(
		"rolls back every source component and import item after a late commit failure",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				assertExitFails(
					yield* Effect.exit(commitUserCommand({ input: input.input, command: input.command })),
					new DbError({ message: "Injected atomic commit failure" }),
				);
				expect(yield* (yield* AtomicWriteObservation).staged).toEqual({
					events: 1,
					entities: 1,
					relationships: 1,
				});
				const entities = yield* input.session.run((db) =>
					db
						.select()
						.from(tables.entity)
						.where(eq(tables.entity.entitySchemaPluginId, input.pluginId)),
				);
				const relationships = yield* input.session.run((db) =>
					db
						.select()
						.from(tables.relationship)
						.where(eq(tables.relationship.relationshipSchemaPluginId, input.pluginId)),
				);
				const events = yield* input.session.run((db) =>
					db
						.select()
						.from(tables.event)
						.where(eq(tables.event.eventSchemaPluginId, input.pluginId)),
				);
				expect(entities).toMatchObject([{ name: "Existing target" }]);
				expect(relationships).toEqual([]);
				expect(events).toEqual([]);
			}),
		testTimeout,
	);
});

type Fixture = Effect.Success<ReturnType<typeof fixture>>;

const nextCommand = (input: Fixture, principal = input.command.writeContext) => ({
	...input.command,
	...command(crypto.randomUUID()),
	writeContext: principal,
	accountUserId: input.command.accountUserId,
});

const commit = (input: ChangeSet, lifecycle: ScriptLifecycleCommand) =>
	Effect.flatMap(ChangeSets, (changes) =>
		changes.commitScript(input, lifecycle, unrecorded(Function.identity<CommittedChanges>)),
	);

const automationSubject = (input: Fixture) => {
	const { pluginRevision } = input.command.writeContext;
	assert(pluginRevision);
	return {
		accountUserId: userId,
		executionUserId: userId,
		pluginId: pluginRevision.id,
		type: "automation-run" as const,
		causation: input.command.causation,
		pluginRevisionId: pluginRevision.revisionId,
		pluginConfigRevisionId: pluginRevision.configRevisionId,
	};
};

const automationRun = (input: Fixture) =>
	({
		...input.command.writeContext,
		subject: {
			...automationSubject(input),
			stage: "after" as const,
			runId: AutomationRunId.make(`run-${crypto.randomUUID()}`),
			triggerId: AutomationTriggerId.make(`trigger-${crypto.randomUUID()}`),
		},
	}) satisfies ScriptExecutionPrincipal;

const policyRun = (input: Fixture) =>
	({
		...input.command.writeContext,
		subject: { ...automationSubject(input), stage: "before" as const },
	}) satisfies ScriptExecutionPrincipal;

const targetOf = (input: Fixture) => {
	const [relation] = input.input.relationships.upserts;
	assert(relation?.target.kind === "existing");
	return relation.target.entityId;
};

const rejection = (part: string) => ({ part, _tag: "ChangeSetRejected" });

const recordSchema = (input: Fixture) => ({
	slug: EntitySchemaSlug.make("record"),
	owner: definitionOwner(input.pluginId),
});

const atomicLink = (input: Fixture) => ({
	owner: definitionOwner(input.pluginId),
	slug: RelationshipSchemaSlug.make("atomic-link"),
});

const existing = (entityId: EntityId) => ({ entityId, kind: "existing" as const });

const stringField = (key: string) => ({
	description: key,
	type: "string" as const,
	label: { key: `test.${key}` },
});

const kernelWriterCommand = (input: Fixture): DomainLifecycleCommand => ({
	...command(crypto.randomUUID()),
	writeContext: null,
	accountUserId: input.command.accountUserId,
});

const policyRunsOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const spans: Tracer.Span[] = [];
		yield* effect.pipe(Effect.withTracer(makeRecordingTracer(spans)));
		return spans.filter(({ name }) => name === "LifecyclePolicies.run").length;
	});

const seedEvent = (
	input: Fixture,
	entityId: EntityId,
	sessionEntityId: EntityId | undefined,
	id: string,
) =>
	input.session.transaction(
		Effect.flatMap(EventsRepository, (events) =>
			events.createEvent(new WriteTransaction(), {
				userId,
				entityId,
				id: EventId.make(id),
				properties: { value: "Saved" },
				propertiesSchema: { fields: {} },
				eventSchemaPluginId: input.pluginId,
				eventSchemaSlug: EventSchemaSlug.make("changed"),
				occurredAt: new Date("2026-10-13T00:00:00.000Z"),
				eventSchemaName: { key: "test.changed", namespace: input.pluginId },
				...(sessionEntityId === undefined ? {} : { sessionEntityId }),
			}),
		),
	);

const eventRow = (input: Fixture, id: string) =>
	input.session
		.run((db) =>
			db
				.select({
					entityId: tables.event.entityId,
					properties: tables.event.properties,
					sessionEntityId: tables.event.sessionEntityId,
				})
				.from(tables.event)
				.where(eq(tables.event.id, EventId.make(id))),
		)
		.pipe(Effect.map(([row]) => row ?? null));

const kernelEntity = (input: Fixture) =>
	Effect.gen(function* () {
		const [entity] = yield* (yield* EntitiesRepository).insertEntities([
			{
				userId,
				scope: "user",
				properties: {},
				populatedAt: null,
				name: "Kernel entity",
				entitySchemaPluginId: null,
				id: EntityId.make(yield* randomUuid),
				entitySchemaSlug: EntitySchemaSlug.make("collection"),
			},
		]);
		assert(entity);
		return { ...input, kernelEntityId: entity.id };
	});

const entityBaseline = (input: Fixture, entityId: EntityId) =>
	Effect.gen(function* () {
		const [row] = yield* input.session.run((db) =>
			db
				.select({
					name: tables.entity.name,
					updatedAt: tables.entity.updatedAt,
					properties: tables.entity.properties,
				})
				.from(tables.entity)
				.where(eq(tables.entity.id, entityId)),
		);
		assert(row);
		return { name: row.name, properties: row.properties, updatedAt: row.updatedAt.toISOString() };
	});

const entityUpdates = (
	items: ReadonlyArray<
		readonly [EntityId, Effect.Success<ReturnType<typeof entityBaseline>>, string]
	>,
) =>
	Schema.decodeUnknownEffect(ChangeSet)({
		entities: {
			updates: items.map(([entityId, expected, name]) => ({
				name,
				properties: { name },
				entitySchemaSlug: "record",
				target: { expected, entityId, kind: "update" },
			})),
		},
	});

/** A fixture whose plugin declares a keyed record link, with a committed root and another record. */
const keyedLinkFixture = Effect.gen(function* () {
	const source = revisionPackage("atomic", "fixture", "record");
	const input = yield* fixture({
		...source,
		manifest: {
			...source.manifest,
			relationshipSchemas: [
				...source.manifest.relationshipSchemas,
				{
					keyed: true,
					slug: "atomic-keyed",
					name: { key: "test.link" },
					propertiesSchema: { fields: {} },
					sourceEntitySchemaSlug: "record",
					targetEntitySchemaSlug: "record",
				},
			],
		},
	});
	const root = yield* commitUserCommand(input);
	const [other] = yield* (yield* EntitiesRepository).insertEntities([
		{
			userId,
			scope: "user",
			name: "Other",
			properties: {},
			populatedAt: null,
			id: EntityId.make(yield* randomUuid),
			entitySchemaPluginId: input.pluginId,
			entitySchemaSlug: EntitySchemaSlug.make("record"),
		},
	]);
	assert(other);
	return { root, input, other, target: targetOf(input) };
});

layer(testLayer(false))((test) => {
	test.effect(
		"moves an event's entity references and rewrites its properties for a kernel writer",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commit(
					{ entity: input.input.entity, relationships: input.input.relationships },
					input.command,
				);
				assert(root.entityId);
				const target = targetOf(input);
				yield* seedEvent(input, root.entityId, target, "moved-event");
				const sets = yield* ChangeSets;
				const moved = yield* sets.commit(
					eventChanges(userId, [
						eventMove({
							mergeInto: target,
							mergeFrom: root.entityId,
							properties: { value: "Moved" },
							eventId: EventId.make("moved-event"),
							references: [{ from: target, into: root.entityId }],
						}),
					]),
					kernelWriterCommand(input),
				);
				expect(moved.committed.events.map(({ eventId }) => eventId)).toEqual([
					EventId.make("moved-event"),
				]);
				expect(yield* eventRow(input, "moved-event")).toEqual({
					entityId: target,
					properties: { value: "Moved" },
					sessionEntityId: root.entityId,
				});
				const unchanged = yield* sets.commit(
					eventChanges(userId, [
						eventMove({
							mergeFrom: target,
							mergeInto: target,
							eventId: EventId.make("moved-event"),
						}),
					]),
					kernelWriterCommand(input),
				);
				expect(unchanged.committed.events).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"refuses a cascade delete whose event does not belong to the cascaded entity's owner",
		() =>
			Effect.gen(function* () {
				const input = yield* kernelEntity(yield* fixture());
				const root = yield* commit(
					{ entity: input.input.entity, relationships: input.input.relationships },
					input.command,
				);
				const rootId = root.entityId;
				assert(rootId);
				yield* seedEvent(input, rootId, input.kernelEntityId, "cascaded-event");
				const refused = new DbError({
					message: "Event cascade does not match the authorized entity graph",
				});
				for (const cascadeEntityIds of [[input.kernelEntityId], [targetOf(input)]]) {
					assertExitFails(
						yield* Effect.exit(
							Effect.flatMap(ChangeSets, (sets) =>
								sets.commit(
									eventChanges(userId, [
										{
											kind: "delete",
											cascadeEntityIds,
											itemIdentity: "cascade",
											eventId: EventId.make("cascaded-event"),
										},
									]),
									kernelWriterCommand(input),
								),
							),
						),
						refused,
					);
				}
				expect(yield* eventRow(input, "cascaded-event")).not.toBeNull();
				yield* Effect.flatMap(ChangeSets, (sets) =>
					sets.commit(
						eventChanges(userId, [
							{
								kind: "delete",
								itemIdentity: "cascade",
								cascadeEntityIds: [rootId],
								eventId: EventId.make("cascaded-event"),
							},
						]),
						kernelWriterCommand(input),
					),
				);
				expect(yield* eventRow(input, "cascaded-event")).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"clears and merges entity data for a kernel writer of any schema and answers their results",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				const target = targetOf(input);
				const sets = yield* ChangeSets;
				const merged = yield* sets.commit(
					{
						userId,
						entities: {
							merges: [{ mergeInto: target, entitySchema: null, mergeFrom: root.entityId }],
						},
					},
					kernelWriterCommand(input),
				);
				expect(merged.merged).toEqual([
					{
						mergeInto: target,
						movedEventsCount: 1,
						mergeFrom: root.entityId,
						movedRelationshipsCount: 1,
					},
				]);
				expect(merged.committed.events).toHaveLength(1);
				const cleared = yield* sets.commit(
					{ userId, entities: { clears: [{ entityId: target, entitySchema: null }] } },
					kernelWriterCommand(input),
				);
				expect(cleared.cleared).toEqual([
					{ entityId: target, deletedEventsCount: 1, deletedRelationshipsCount: 0 },
				]);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ id: tables.event.id })
							.from(tables.event)
							.where(
								inArray(
									tables.event.id,
									root.events.map(({ eventId }) => eventId),
								),
							),
					),
				).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"runs the event policies of an entity data clear and merge once per batch",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture(guardedPackage(undefined, ["update", "delete"]));
				const root = yield* commit(
					{ entity: input.input.entity, relationships: input.input.relationships },
					input.command,
				);
				assert(root.entityId);
				const target = targetOf(input);
				for (const index of [0, 1, 2]) {
					yield* seedEvent(input, root.entityId, undefined, `policy-event-${index}`);
				}
				expect(
					yield* policyRunsOf(
						commit(
							{
								entities: {
									merges: [
										{ mergeInto: target, mergeFrom: root.entityId, entitySchemaSlug: "record" },
									],
								},
							},
							nextCommand(input),
						),
					),
				).toBe(1);
				expect(
					yield* policyRunsOf(
						commit(
							{ entities: { clears: [{ entityId: target, entitySchemaSlug: "record" }] } },
							nextCommand(input),
						),
					),
				).toBe(1);
				expect(yield* eventRow(input, "policy-event-0")).toBeNull();
			}),
		testTimeout,
	);

	test.effect(
		"commits relationship deletes, entity data clears and entity deletes",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				const target = targetOf(input);
				const rowsOf = Effect.gen(function* () {
					return {
						entities: yield* input.session.run((db) =>
							db
								.select({ id: tables.entity.id })
								.from(tables.entity)
								.where(eq(tables.entity.id, root.entityId)),
						),
						events: yield* input.session.run((db) =>
							db
								.select({ id: tables.event.id })
								.from(tables.event)
								.where(eq(tables.event.entityId, root.entityId)),
						),
						relationships: yield* input.session.run((db) =>
							db
								.select({ id: tables.relationship.id })
								.from(tables.relationship)
								.where(eq(tables.relationship.sourceEntityId, root.entityId)),
						),
					};
				});
				expect(yield* rowsOf).toMatchObject({ events: [{}], entities: [{}], relationships: [{}] });
				yield* commit(
					{
						relationships: {
							deletes: [
								{
									relationshipSchemaSlug: "atomic-link",
									target: { kind: "existing", entityId: target },
									source: { kind: "existing", entityId: root.entityId },
								},
							],
						},
					},
					nextCommand(input),
				);
				expect((yield* rowsOf).relationships).toEqual([]);
				yield* commit(
					{ entities: { clears: [{ entityId: root.entityId, entitySchemaSlug: "record" }] } },
					nextCommand(input),
				);
				expect((yield* rowsOf).events).toEqual([]);
				yield* commit(
					{ entities: { deletes: [{ entityId: root.entityId, entitySchemaSlug: "record" }] } },
					nextCommand(input),
				);
				expect(yield* rowsOf).toEqual({ events: [], entities: [], relationships: [] });
			}),
		testTimeout,
	);

	test.effect(
		"merges one entity's data into another",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				const target = targetOf(input);
				yield* commit(
					{
						entities: {
							merges: [{ mergeInto: target, mergeFrom: root.entityId, entitySchemaSlug: "record" }],
						},
					},
					nextCommand(input),
				);
				const moved = yield* input.session.run((db) =>
					db
						.select({ entityId: tables.event.entityId })
						.from(tables.event)
						.where(
							inArray(
								tables.event.id,
								root.events.map(({ eventId }) => eventId),
							),
						),
				);
				expect(moved).toEqual([{ entityId: target }]);
			}),
		testTimeout,
	);

	test.effect(
		"updates existing entities against their baselines and fails a stale one as a conflict",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const target = targetOf(input);
				const read = entityBaseline(input, target);
				const original = yield* read;
				yield* commit(yield* entityUpdates([[target, original, "Renamed"]]), nextCommand(input));
				expect(yield* read).toMatchObject({ name: "Renamed", properties: { name: "Renamed" } });
				assertExitFails(
					yield* Effect.exit(
						commit(yield* entityUpdates([[target, original, "Stale"]]), nextCommand(input)),
					),
					new CommitConflict({ reason: { entityId: target, code: "entity-stale" } }),
				);
				expect(yield* read).toMatchObject({ name: "Renamed" });
			}),
		testTimeout,
	);

	test.effect(
		"applies entity merges before entity updates",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				const target = targetOf(input);
				const read = entityBaseline(input, target);
				const updates = yield* entityUpdates([[target, yield* read, "Merged"]]);
				yield* commit(
					{
						entities: {
							...updates.entities,
							merges: [{ mergeInto: target, mergeFrom: root.entityId, entitySchemaSlug: "record" }],
						},
					},
					nextCommand(input),
				);
				expect(yield* read).toMatchObject({ name: "Merged", properties: { name: "Merged" } });
				const moved = yield* input.session.run((db) =>
					db
						.select({ entityId: tables.event.entityId })
						.from(tables.event)
						.where(
							inArray(
								tables.event.id,
								root.events.map(({ eventId }) => eventId),
							),
						),
				);
				expect(moved).toEqual([{ entityId: target }]);
			}),
		testTimeout,
	);

	test.effect(
		"merges an entity whose keyed and unkeyed relationships the same change set deletes",
		() =>
			Effect.gen(function* () {
				const { root, input, other, target } = yield* keyedLinkFixture;
				const links = [
					{
						target: existing(other.id),
						source: existing(root.entityId),
						relationshipSchemaSlug: "atomic-link",
					},
					{
						key: "outgoing",
						target: existing(other.id),
						source: existing(root.entityId),
						relationshipSchemaSlug: "atomic-keyed",
					},
					{
						key: "incoming",
						source: existing(other.id),
						target: existing(root.entityId),
						relationshipSchemaSlug: "atomic-keyed",
					},
				];
				yield* commit(
					{
						relationships: {
							upserts: links.map((link) => ({
								...link,
								properties: {},
								propertiesMode: "replace" as const,
							})),
						},
					},
					nextCommand(input),
				);
				yield* commit(
					{
						relationships: { deletes: links },
						entities: {
							merges: [{ mergeInto: target, mergeFrom: root.entityId, entitySchemaSlug: "record" }],
						},
					},
					nextCommand(input),
				);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ entityId: tables.event.entityId })
							.from(tables.event)
							.where(
								inArray(
									tables.event.id,
									root.events.map(({ eventId }) => eventId),
								),
							),
					),
				).toEqual([{ entityId: target }]);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ id: tables.relationship.id })
							.from(tables.relationship)
							.where(eq(tables.relationship.relationshipSchemaPluginId, input.pluginId)),
					),
				).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"merges an entity a keyed relationship targets by moving the target of the same row",
		() =>
			Effect.gen(function* () {
				const { root, input, other, target } = yield* keyedLinkFixture;
				yield* commit(
					{
						relationships: {
							upserts: [
								{
									properties: {},
									key: "incoming",
									propertiesMode: "replace",
									source: existing(other.id),
									target: existing(root.entityId),
									relationshipSchemaSlug: "atomic-keyed",
								},
							],
						},
					},
					nextCommand(input),
				);
				const keyed = input.session.run((db) =>
					db
						.select({
							id: tables.relationship.id,
							targetEntityId: tables.relationship.targetEntityId,
						})
						.from(tables.relationship)
						.where(eq(tables.relationship.relationshipSchemaSlug, "atomic-keyed")),
				);
				const [before] = yield* keyed;
				assert(before);
				yield* commit(
					{
						entities: {
							merges: [{ mergeInto: target, mergeFrom: root.entityId, entitySchemaSlug: "record" }],
						},
					},
					nextCommand(input),
				);
				expect(yield* keyed).toEqual([{ id: before.id, targetEntityId: target }]);
			}),
		testTimeout,
	);

	test.effect(
		"applies a keyed upsert only while the relationship holds its expected properties",
		() =>
			Effect.gen(function* () {
				const source = revisionPackage("atomic", "fixture", "record");
				const input = yield* fixture({
					...source,
					manifest: {
						...source.manifest,
						relationshipSchemas: [
							...source.manifest.relationshipSchemas,
							{
								keyed: true,
								slug: "atomic-keyed",
								name: { key: "test.link" },
								sourceEntitySchemaSlug: "record",
								targetEntitySchemaSlug: "record",
								propertiesSchema: { fields: { origin: stringField("origin") } },
							},
						],
					},
				});
				const root = yield* commitUserCommand(input);
				const copy = {
					key: "copy",
					source: existing(root.entityId),
					target: existing(targetOf(input)),
					propertiesMode: "replace" as const,
					relationshipSchemaSlug: "atomic-keyed",
				};
				const upsert = (origin: string, expected?: string) =>
					commit(
						{
							relationships: {
								upserts: [
									{
										...copy,
										properties: { origin },
										...(expected === undefined
											? {}
											: { expected: { properties: { origin: expected } } }),
									},
								],
							},
						},
						nextCommand(input),
					);
				const conflict = { reason: { code: "concurrent-relationship-change" } };
				expect(yield* upsert("manual", "manual").pipe(Effect.flip)).toMatchObject(conflict);
				yield* upsert("manual");
				yield* upsert("edited", "manual");
				yield* upsert("integration");
				expect(yield* upsert("stale", "edited").pipe(Effect.flip)).toMatchObject(conflict);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ properties: tables.relationship.properties })
							.from(tables.relationship)
							.where(
								and(
									eq(tables.relationship.relationshipSchemaSlug, "atomic-keyed"),
									eq(tables.relationship.relationshipSchemaPluginId, input.pluginId),
								),
							),
					),
				).toEqual([{ properties: { origin: "integration" } }]);
			}),
		testTimeout,
	);

	test.effect(
		"ensures the bootstrap's entity once and refuses ensures from other scripts",
		() =>
			Effect.gen(function* () {
				const source = revisionPackage("atomic", "fixture", "record");
				const input = yield* fixture({
					...source,
					manifest: {
						...source.manifest,
						userBootstrap: [
							{ slug: "bootstrap", description: "Bootstrap", scriptSlug: "atomic.task" },
						],
					},
				});
				const [task] = yield* input.session.run((db) =>
					db
						.select({ id: tables.sandboxScript.id })
						.from(tables.sandboxScript)
						.where(
							and(
								eq(tables.sandboxScript.slug, "atomic.task"),
								eq(tables.sandboxScript.pluginRevisionId, input.revisionId),
							),
						),
				);
				assert(task);
				const subject = { userId, type: "user" as const };
				const pin = yield* (yield* SandboxRepository.make).getScriptPin(
					SandboxScriptId.make(task.id),
					undefined,
					subject,
				);
				assert(pin?.pluginRevision);
				expect(pin.pluginRevision.userBootstrapScriptSlugs).toEqual(["atomic.task"]);
				const bootstrap = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
				const ensure = {
					entities: {
						ensures: [{ name: "Ensured", properties: { name: "E" }, entitySchemaSlug: "record" }],
					},
				} satisfies ChangeSet;
				expect(yield* Effect.flip(commit(ensure, nextCommand(input)))).toMatchObject(
					rejection("entities.ensures"),
				);
				yield* commit(
					{ entities: { deletes: [{ entityId: targetOf(input), entitySchemaSlug: "record" }] } },
					nextCommand(input),
				);
				yield* commit(ensure, nextCommand(input, bootstrap));
				yield* commit(ensure, nextCommand(input, bootstrap));
				const ensured = yield* input.session.run((db) =>
					db
						.select({ name: tables.entity.name })
						.from(tables.entity)
						.where(eq(tables.entity.entitySchemaPluginId, input.pluginId)),
				);
				expect(ensured).toEqual([{ name: "Ensured" }]);
			}),
		testTimeout,
	);

	test.effect(
		"emits signals and admits notifications from a user automation run",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const run = automationRun(input);
				yield* commit(
					{
						notifications: [{ key: "notification.done" }],
						signals: [{ properties: {}, discriminator: "first", schemaSlug: "atomic.signal" }],
					},
					nextCommand(input, run),
				);
				const signals = yield* input.session.run((db) =>
					db
						.select({ id: tables.automationTrigger.id })
						.from(tables.automationTrigger)
						.where(eq(tables.automationTrigger.category, "signal")),
				);
				expect(signals).toHaveLength(1);
				const notifications = yield* input.session.run((db) =>
					db
						.select({ sourceKey: tables.notification.sourceKey })
						.from(tables.notification)
						.where(eq(tables.notification.userId, userId)),
				);
				expect(notifications).toEqual([
					{ sourceKey: `${run.subject.runId}-changes-0-notification` },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"records a kernel writer's provider import completion trigger",
		() =>
			Effect.gen(function* () {
				const source = revisionPackage("atomic", "fixture", "record");
				const [notify] = source.manifest.hooks;
				assert(notify);
				const input = yield* fixture({
					...source,
					manifest: {
						...source.manifest,
						hooks: [
							{
								...notify,
								targets: [
									...notify.targets,
									{
										operation: "complete",
										entitySchemaSlug: "record",
										resource: "provider-entity-import",
									},
								],
							},
						],
					},
				});
				const entityId = targetOf(input);
				yield* (yield* ChangeSets).commit(
					{
						userId,
						triggers: [
							{
								scopeUserId: userId,
								owner: definitionOwner(input.pluginId),
								change: {
									userId,
									entityId,
									category: "change",
									externalId: "root",
									operation: "complete",
									providerId: input.providerId,
									resource: "provider-entity-import",
									entitySchemaSlug: EntitySchemaSlug.make("record"),
									entitySchemaPluginId: PluginId.make(input.pluginId),
								},
							},
						],
					},
					kernelWriterCommand(input),
				);
				expect(
					yield* input.session.run((db) =>
						db
							.select({
								operation: tables.automationTrigger.operation,
								scopeUserId: tables.automationTrigger.scopeUserId,
								resourceKind: tables.automationTrigger.resourceKind,
							})
							.from(tables.automationTrigger)
							.where(eq(tables.automationTrigger.resourceKind, "provider-entity-import")),
					),
				).toEqual([
					{ scopeUserId: userId, operation: "complete", resourceKind: "provider-entity-import" },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"accepts a user fold request for the writer's own entities",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				expect(
					yield* commit(
						{ folds: { scope: "user", entityIds: [root.entityId] } },
						nextCommand(input),
					),
				).toEqual({ events: [] });
			}),
		testTimeout,
	);

	test.effect(
		"requests folds under the commit transaction's reading of the user's plugins",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const root = yield* commitUserCommand(input);
				const spans: Tracer.Span[] = [];
				yield* commit(
					{ ...input.input, folds: { scope: "user", entityIds: [root.entityId] } },
					nextCommand(input),
				).pipe(Effect.withTracer(makeRecordingTracer(spans)));
				expect(
					recordedStatements(spans).filter((text) => text.includes("from plugin_installation i")),
				).toHaveLength(2);
			}),
		testTimeout,
	);

	test.effect(
		"commits concurrent settings patches for one user",
		() =>
			Effect.gen(function* () {
				const source = revisionPackage("atomic", "fixture", "record");
				const input = yield* fixture({
					...source,
					manifest: {
						...source.manifest,
						userSettingsSchema: {
							unknownKeys: "strict",
							fields: { theme: stringField("theme"), layout: stringField("layout") },
						},
					},
				});
				const changeSets = yield* ChangeSets;
				const patches: ReadonlyArray<readonly [string, Record<string, string>]> = [
					["theme", { theme: "dark" }],
					["layout", { layout: "grid" }],
				];
				const started = yield* Ref.make(0);
				const bothStarted = yield* Deferred.make<void>();
				const loads = yield* Effect.forEach(patches, () => Ref.make(0));
				// A commit loads its receipt once before preparing, where it waits until both commits have
				// started, and once in each commit transaction it starts, which a transaction retried after
				// a deadlock loads again.
				yield* Effect.forEach(
					patches,
					([item, settings], index) => {
						const count = loads[index];
						assert(count);
						return changeSets.commitScript(
							{ settings },
							{
								...command(`${input.command.causation.executionId}:${item}`),
								writeContext: input.command.writeContext,
								accountUserId: input.command.accountUserId,
							},
							{
								...unrecorded(Function.identity<CommittedChanges>),
								load: Effect.gen(function* () {
									if ((yield* Ref.updateAndGet(count, (value) => value + 1)) === 1) {
										if (
											(yield* Ref.updateAndGet(started, (value) => value + 1)) === patches.length
										) {
											yield* Deferred.succeed(bothStarted, undefined);
										}
										yield* Deferred.await(bothStarted);
									}
									return null;
								}),
							},
						);
					},
					{ concurrency: "unbounded" },
				);
				expect(yield* Effect.forEach(loads, Ref.get)).toEqual([2, 2]);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ userSettings: tables.pluginInstallation.userSettings })
							.from(tables.pluginInstallation)
							.where(
								and(
									eq(tables.pluginInstallation.userId, userId),
									eq(tables.pluginInstallation.pluginId, input.pluginId),
								),
							),
					),
				).toEqual([{ userSettings: { theme: "dark", layout: "grid" } }]);
			}),
		testTimeout,
	);

	test.effect(
		"rejects every part its writer's principal may not write",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const user = input.command.writeContext;
				assert(user.subject.type === "user" && user.pluginRevision);
				const run = automationRun(input);
				const target = targetOf(input);
				const events = {
					changes: [
						{
							itemIdentity: "denied",
							kind: "create" as const,
							eventSchemaSlug: "changed",
							properties: { value: "Denied" },
							entity: { entityId: target, kind: "existing" as const },
						},
					],
				};
				const cases: ReadonlyArray<readonly [ChangeSet, ScriptExecutionPrincipal, string]> = [
					[{ entity: input.input.entity }, run, "entity"],
					[{ settings: { theme: "dark" } }, run, "settings"],
					[
						{ entities: { deletes: [{ entityId: target, entitySchemaSlug: "record" }] } },
						run,
						"entities.deletes",
					],
					[
						yield* entityUpdates([[target, yield* entityBaseline(input, target), "Denied"]]),
						run,
						"entities.updates",
					],
					[
						{ settings: { theme: "dark" } },
						{
							...user,
							subject: { ...user.subject, integrationId: IntegrationId.make("integration") },
						},
						"settings",
					],
					[
						{ signals: [{ properties: {}, discriminator: "d", schemaSlug: "atomic.signal" }] },
						user,
						"signals",
					],
					[{ notifications: [{ key: "notification.done" }] }, user, "notifications"],
					[
						{
							globalEntities: [
								{
									name: "G",
									properties: {},
									externalId: "g",
									populatedAt: null,
									entitySchemaSlug: "record",
								},
							],
						},
						user,
						"globalEntities",
					],
					[
						{
							globalRelationships: [
								{
									relationships: [],
									relationshipSchemaSlug: "atomic-link",
									selector: { type: "self", entitySchemaSlug: "record" },
								},
							],
						},
						user,
						"globalRelationships",
					],
					[{ events }, { ...user, subject: { userId, type: "projection" } }, "changes"],
					[{ events }, policyRun(input), "changes"],
					[{ events }, { ...user, subject: { type: "system" } }, "events"],
					[
						{ folds: { scope: "all-users", entityIds: [target] } },
						{ ...user, subject: { type: "system" } },
						"folds",
					],
					[
						{ entities: { deletes: [{ entityId: target, entitySchemaSlug: "undeclared" }] } },
						user,
						"schemas",
					],
				];
				for (const [changes, principal, part] of cases) {
					expect(yield* Effect.flip(commit(changes, nextCommand(input, principal)))).toMatchObject(
						rejection(part),
					);
				}
				const writtenEvents = yield* input.session.run((db) =>
					db
						.select({ id: tables.event.id })
						.from(tables.event)
						.where(eq(tables.event.entityId, target)),
				);
				expect(writtenEvents).toEqual([]);
			}),
		testTimeout,
	);

	test.effect(
		"commits keyed creates and a matched entity with the relationships and events that name them",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const target = targetOf(input);
				const rows = (name: string) =>
					input.session.run((db) =>
						db
							.select({ id: tables.entity.id })
							.from(tables.entity)
							.where(and(eq(tables.entity.name, name), eq(tables.entity.userId, userId))),
					);
				const committed = yield* (yield* ChangeSets).commit(
					{
						userId,
						events: {
							changes: [
								{
									kind: "create",
									itemIdentity: "event",
									eventSchemaSlug: "changed",
									properties: { value: "Saved" },
									entity: { kind: "keyed", key: "created" },
									session: { kind: "keyed", key: "matched" },
								},
							],
						},
						relationships: {
							upserts: [
								{
									properties: {},
									itemIdentity: "link",
									propertiesMode: "replace",
									relationshipSchema: atomicLink(input),
									source: { kind: "keyed", key: "created" },
									target: { kind: "keyed", key: "matched" },
								},
							],
						},
						entities: {
							creates: [
								{
									key: "created",
									name: "Created",
									itemIdentity: "created",
									properties: { name: "Created" },
									entitySchema: recordSchema(input),
								},
								{
									key: "matched",
									properties: {},
									name: "Unused",
									itemIdentity: "matched",
									entitySchema: recordSchema(input),
									match: {
										properties: {},
										required: true,
										name: "existing target",
										nameNormalization: "slug",
									},
								},
							],
						},
					},
					kernelWriterCommand(input),
					{ entities: { verbatimIdentities: true }, relationships: { verbatimIdentities: true } },
				);
				const [created, matched] = committed.entities;
				assert(created && matched);
				expect(created.itemIdentity).toBe("created");
				expect(matched).toMatchObject({ entity: { id: target }, itemIdentity: "matched" });
				expect(committed.relationships).toMatchObject([
					{
						operation: "create",
						itemIdentity: "link",
						relationship: { targetEntityId: target, sourceEntityId: created.entity.id },
					},
				]);
				expect(
					yield* input.session.run((db) =>
						db
							.select({
								entityId: tables.event.entityId,
								sessionEntityId: tables.event.sessionEntityId,
							})
							.from(tables.event)
							.where(eq(tables.event.entityId, created.entity.id)),
					),
				).toEqual([{ sessionEntityId: target, entityId: created.entity.id }]);
				expect(yield* rows("Unused")).toEqual([]);
				assertExitFails(
					yield* Effect.exit(
						(yield* ChangeSets).commit(
							{
								userId,
								entities: {
									creates: [
										{
											properties: {},
											name: "Missing",
											entitySchema: recordSchema(input),
											match: {
												properties: {},
												required: true,
												name: "Missing",
												nameNormalization: "exact",
											},
										},
									],
								},
							},
							kernelWriterCommand(input),
						),
					),
					new ChangeSetRejected({
						part: "entities.creates",
						message: "entity-create:0 matches no entity",
					}),
				);
			}),
		testTimeout,
	);

	test.effect(
		"matches the preferred entity first among the entities a name match finds",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const target = targetOf(input);
				const [other] = yield* input.session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							userId,
							name: "Existing-Target",
							entitySchemaSlug: "record",
							entitySchemaPluginId: input.pluginId,
						})
						.returning({ id: tables.entity.id }),
				);
				assert(other);
				const preferred = EntityId.make(other.id);
				const create = (key: string, prefer?: EntityId) => ({
					key,
					properties: {},
					name: "Unused",
					itemIdentity: key,
					entitySchema: recordSchema(input),
					match: {
						properties: {},
						required: true,
						name: "existing target",
						nameNormalization: "slug" as const,
						...(prefer === undefined ? {} : { prefer }),
					},
				});
				const committed = yield* (yield* ChangeSets).commit(
					{ userId, entities: { creates: [create("first"), create("preferred", preferred)] } },
					kernelWriterCommand(input),
					{ entities: { verbatimIdentities: true } },
				);
				expect(committed.entities.map(({ entity }) => entity.id)).toEqual([target, preferred]);
			}),
		testTimeout,
	);

	test.effect(
		"commits two creates matching one name into the entity the first wrote",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture(
					policyPackage({ entity: { properties: ["name"] } }, [
						{ resource: "entity", operation: "create", entitySchemaSlug: "record" },
					]),
				);
				const { match } = yield* LifecyclePolicies;
				const raced = yield* Ref.make(false);
				const shared = (sets: ChangeSets["Service"]) =>
					sets.commit(
						{
							userId,
							entities: {
								creates: [
									{
										name: "Shared",
										properties: {},
										entitySchema: recordSchema(input),
										match: {
											name: "Shared",
											properties: {},
											required: false,
											nameNormalization: "exact",
										},
									},
								],
							},
						},
						kernelWriterCommand(input),
					);
				const changeSets: ChangeSets["Service"] = yield* ChangeSets.make.pipe(
					Effect.provideService(
						LifecyclePolicies,
						LifecyclePolicies.of({
							match,
							run: ({ request: { items } }) =>
								Effect.gen(function* () {
									if (!(yield* Ref.getAndSet(raced, true))) {
										yield* shared(changeSets).pipe(Effect.orDie);
									}
									return {
										items: items.map(({ itemIdentity }) => ({
											itemIdentity,
											decision: { action: "allow" as const },
										})),
									};
								}),
						}),
					),
				);
				const joined = yield* shared(changeSets);
				const stored = yield* input.session.run((db) =>
					db
						.select({ id: tables.entity.id })
						.from(tables.entity)
						.where(and(eq(tables.entity.name, "Shared"), eq(tables.entity.userId, userId))),
				);
				expect(stored).toEqual(joined.entities.map(({ entity }) => ({ id: entity.id })));
			}),
		testTimeout,
	);

	test.effect(
		"records a relationship's event from what it wrote and writes neither when the event fails",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const target = targetOf(input);
				const recorded = (properties: (relationshipId: string) => unknown): Changes => ({
					userId,
					entities: {
						creates: [
							{ key: "source", name: "Source", properties: {}, entitySchema: recordSchema(input) },
						],
					},
					relationships: {
						upserts: [
							{
								properties: {},
								itemIdentity: "link",
								propertiesMode: "replace",
								relationshipSchema: atomicLink(input),
								source: { kind: "keyed", key: "source" },
								target: { kind: "existing", entityId: target },
							},
						],
						events: [
							{
								relationship: "link",
								itemIdentity: "recorded",
								eventSchemaSlug: "changed",
								occurredAt: input.command.occurredAt,
								entity: { kind: "existing", entityId: target },
								properties: ({ operation, relationship }) =>
									operation === "create" && relationship
										? { value: properties(relationship.id) }
										: null,
							},
						],
					},
				});
				const sets = yield* ChangeSets;
				const written = yield* sets.commit(
					recorded((relationshipId) => relationshipId),
					kernelWriterCommand(input),
					{ relationships: { verbatimIdentities: true } },
				);
				const [link] = written.relationships;
				assert(link?.relationship);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ properties: tables.event.properties })
							.from(tables.event)
							.where(eq(tables.event.entityId, target)),
					),
				).toEqual([{ properties: { value: link.relationship.id } }]);
				const linksBefore = yield* input.session.run((db) =>
					db.select({ id: tables.relationship.id }).from(tables.relationship),
				);
				assertExitFails(
					yield* Effect.exit(
						sets.commit(
							recorded(() => 5),
							kernelWriterCommand(input),
							{ relationships: { verbatimIdentities: true } },
						),
					),
					new EventBadRequest({ reason: { code: "invalid-properties" } }),
				);
				expect(
					yield* input.session.run((db) =>
						db.select({ id: tables.relationship.id }).from(tables.relationship),
					),
				).toEqual(linksBefore);
			}),
		testTimeout,
	);
});

layer(testLayer(false))((test) => {
	test.effect(
		"upserts global entities and the relationships that name them from a system provider script",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const owner = UserId.make("owner");
				yield* session.run((db) =>
					db.insert(tables.user).values({ id: owner, name: "Owner", email: "owner@example.test" }),
				);
				const installed = yield* installRevisionPackage(
					revisionPackage("global", "fixture", "record"),
				);
				const runtime = yield* PluginRuntimeResolver;
				const provider = yield* runtime.findProviderAvailableToUserByReference(owner, {
					slug: "global-provider",
					owner: definitionOwner(installed.pluginId),
				});
				assert(provider);
				const script = yield* runtime.resolveUserDetailsScript(owner, provider.id);
				const subject = { type: "system" as const };
				const pin = yield* (yield* SandboxRepository.make).getScriptPin(
					script.id,
					undefined,
					subject,
				);
				assert(pin?.pluginRevision?.scope === "system" && pin.providerId !== null);
				const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({ ...pin, subject });
				const upserted = {
					externalId: "g1",
					kind: "upserted" as const,
					entitySchemaSlug: "record",
				};
				yield* commit(
					{
						globalEntities: [
							{
								name: "Global",
								externalId: "g1",
								populatedAt: null,
								entitySchemaSlug: "record",
								properties: { name: "Global" },
							},
						],
						globalRelationships: [
							{
								relationshipSchemaSlug: "global-link",
								selector: { type: "self", entitySchemaSlug: "record" },
								relationships: [{ properties: {}, source: upserted, target: upserted }],
							},
						],
					},
					{ ...command(yield* randomUuid, owner), writeContext: principal },
				);
				const [entity] = yield* session.run((db) =>
					db
						.select()
						.from(tables.entity)
						.where(eq(tables.entity.entitySchemaPluginId, installed.pluginId)),
				);
				expect(entity).toMatchObject({
					userId: null,
					externalId: "g1",
					providerId: pin.providerId,
				});
				assert(entity);
				expect(
					yield* session.run((db) =>
						db
							.select({
								userId: tables.relationship.userId,
								sourceEntityId: tables.relationship.sourceEntityId,
								targetEntityId: tables.relationship.targetEntityId,
							})
							.from(tables.relationship)
							.where(eq(tables.relationship.relationshipSchemaPluginId, installed.pluginId)),
					),
				).toEqual([{ userId: null, sourceEntityId: entity.id, targetEntityId: entity.id }]);
			}),
		testTimeout,
	);
});

layer(testLayer(false, false))((test) => {
	test.effect(
		"writes no event or signal when a later notification admission fails",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const target = targetOf(input);
				assertExitFails(
					yield* Effect.exit(
						commit(
							{
								notifications: [{ key: "notification.done" }],
								signals: [{ properties: {}, discriminator: "late", schemaSlug: "atomic.signal" }],
								events: {
									changes: [
										{
											kind: "create",
											itemIdentity: "late",
											eventSchemaSlug: "changed",
											properties: { value: "Late" },
											entity: { kind: "existing", entityId: target },
										},
									],
								},
							},
							nextCommand(input, automationRun(input)),
						),
					),
					new DbError({ message: "Notification source has been cancelled or settled" }),
				);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ id: tables.event.id })
							.from(tables.event)
							.where(eq(tables.event.entityId, target)),
					),
				).toEqual([]);
				expect(
					yield* input.session.run((db) =>
						db
							.select({ id: tables.automationTrigger.id })
							.from(tables.automationTrigger)
							.where(eq(tables.automationTrigger.category, "signal")),
					),
				).toEqual([]);
			}),
		testTimeout,
	);
});

const notificationInput = (executionUserId: UserId) =>
	Schema.decodeEffect(automationInputSchema)({
		automation: {
			executionUserId,
			runId: "run-notification",
			triggerId: "trigger-notification",
			hookSlug: "automation.notification",
			occurredAt: "2026-09-15T00:00:00.000Z",
			causation: {
				depth: 0,
				parentRunId: null,
				lane: "background",
				source: "integration",
				parentTriggerId: null,
				executionId: "execution-notification",
				rootExecutionId: "execution-notification",
				initiator: { kind: "user", id: executionUserId },
			},
			payload: {
				operation: "emit",
				category: "signal",
				resource: "signal",
				signalSchemaPluginId: null,
				actorUserId: executionUserId,
				signalSchemaSlug: "integration.disabled",
				properties: {
					providerName: {
						namespace: KERNEL_NAMESPACE,
						key: "definition.integration-provider.data-json.name",
					},
				},
			},
		},
	});

layer(ScriptChangesLayer.pipe(Layer.provideMerge(testLayer(false))))((test) => {
	test.effect(
		"commits a keyed script execution's changes once and replays its result",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const commitKeyed = Effect.flatMap(ScriptChanges, (scripts) =>
					scripts.commitKeyed({
						lane: "background",
						changes: input.input,
						executionId: "workflow-step-1",
						occurredAt: input.command.occurredAt,
						principal: input.command.writeContext,
					}),
				);
				const first = yield* commitKeyed;
				expect(yield* commitKeyed).toEqual(first);
				assert(first.entityId);
				const events = yield* input.session.run((db) =>
					db
						.select({ id: tables.event.id })
						.from(tables.event)
						.where(eq(tables.event.entityId, first.entityId ?? "")),
				);
				expect(events).toHaveLength(1);
			}),
		testTimeout,
	);

	test.effect(
		"admits the kernel notification script's notifications in the kernel namespace",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const run = automationRun(input);
				const kernelRun = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
					...run,
					kernelScript: true,
					pluginRevision: null,
					subject: {
						...run.subject,
						pluginId: null,
						pluginRevisionId: null,
						pluginConfigRevisionId: null,
					},
				});
				const result = yield* notificationDefinition.run(yield* notificationInput(userId));
				assert(result.changes);
				yield* commit(result.changes, nextCommand(input, kernelRun));
				const admitted = yield* input.session.run((db) =>
					db
						.select({ request: tables.notification.request })
						.from(tables.notification)
						.where(eq(tables.notification.userId, userId)),
				);
				expect(admitted).toMatchObject([
					{
						request: {
							kind: "message",
							message: { namespace: KERNEL_NAMESPACE, key: "notification.integration-disabled" },
						},
					},
				]);
			}),
		testTimeout,
	);
});

/** A clear or merge naming an entity of another plugin or schema is refused; other parts are invalid. */
const rejectedReference = (part: string, message: string) =>
	part === "entities.clears" || part === "entities.merges"
		? { code: "refused", message: kernelMessage("error.entity-user-data.schema-mismatch") }
		: { code: "invalid", message: `${part}: ${message}` };

layer(ScriptChangesLayer.pipe(Layer.provideMerge(testLayer(false))))((test) => {
	test.effect(
		"rejects references to another plugin's entities and events as invalid changes and treats another user's entities as missing",
		() =>
			Effect.gen(function* () {
				const own = yield* fixture();
				const foreign = yield* fixture(revisionPackage("foreign", "fixture", "record"));
				const ownEntity = targetOf(own);
				const foreignEntity = targetOf(foreign);
				const [foreignEvent] = (yield* commit(
					{ events: eventCreate({ kind: "existing", entityId: foreignEntity }) },
					nextCommand(foreign),
				)).events;
				assert(foreignEvent);
				const update = yield* Schema.decodeUnknownEffect(ChangeSetEntityUpdate.fields.target)({
					kind: "update",
					entityId: foreignEntity,
					expected: yield* entityBaseline(foreign, foreignEntity),
				});
				const otherUser = UserId.make(`other-${yield* randomUuid}`);
				yield* own.session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: otherUser, name: "Other", email: `${otherUser}@example.test` }),
				);
				const [otherUserRow] = yield* (yield* EntitiesRepository).insertEntities([
					{
						scope: "user",
						properties: {},
						populatedAt: null,
						userId: otherUser,
						name: "Other user's record",
						entitySchemaPluginId: own.pluginId,
						id: EntityId.make(yield* randomUuid),
						entitySchemaSlug: EntitySchemaSlug.make("record"),
					},
				]);
				assert(otherUserRow);
				const otherUserEntity = otherUserRow.id;
				const collectionEntity = EntityId.make(yield* randomUuid);
				const collectionEvent = EventId.make(yield* randomUuid);
				yield* own.session.run((db) =>
					db
						.insert(tables.entity)
						.values({
							userId,
							name: "Collection",
							id: collectionEntity,
							entitySchemaPluginId: null,
							entitySchemaSlug: "collection",
						}),
				);
				yield* own.session.run((db) =>
					db
						.insert(tables.event)
						.values({
							userId,
							id: collectionEvent,
							occurredAt: new Date(),
							eventSchemaPluginId: null,
							entityId: collectionEntity,
							eventSchemaSlug: "collection-entry",
						}),
				);
				const run = automationRun(own);
				const attacks: Record<
					string,
					readonly [string, string, typeof ChangeSet.Encoded, ScriptExecutionPrincipal?]
				> = {
					"fold subject": [
						"folds",
						foreignEntity,
						{ folds: { scope: "user", entityIds: [foreignEntity] } },
					],
					"another user's fold subject": [
						"folds",
						otherUserEntity,
						{ folds: { scope: "user", entityIds: [otherUserEntity] } },
					],
					"signal subject": [
						"signals",
						foreignEntity,
						{
							signals: [
								{
									properties: {},
									discriminator: "foreign",
									schemaSlug: "atomic.signal",
									subjectEntityId: foreignEntity,
								},
							],
						},
						run,
					],
					"another user's signal subject": [
						"signals",
						otherUserEntity,
						{
							signals: [
								{
									properties: {},
									discriminator: "other-user",
									schemaSlug: "atomic.signal",
									subjectEntityId: otherUserEntity,
								},
							],
						},
						run,
					],
					"event entity": [
						"events",
						foreignEntity,
						{ events: eventCreate({ kind: "existing", entityId: foreignEntity }) },
					],
					"kernel-owned entity": [
						"events",
						collectionEntity,
						{ events: eventCreate({ kind: "existing", entityId: collectionEntity }) },
					],
					"another user's entity": [
						"events",
						otherUserEntity,
						{ events: eventCreate({ kind: "existing", entityId: otherUserEntity }) },
					],
					"entity clear": [
						"entities.clears",
						foreignEntity,
						{ entities: { clears: [{ entityId: foreignEntity, entitySchemaSlug: "record" }] } },
					],
					"entity delete": [
						"entities.deletes",
						foreignEntity,
						{ entities: { deletes: [{ entityId: foreignEntity, entitySchemaSlug: "record" }] } },
					],
					"another user's entity delete": [
						"entities.deletes",
						otherUserEntity,
						{ entities: { deletes: [{ entityId: otherUserEntity, entitySchemaSlug: "record" }] } },
					],
					"kernel-owned event": [
						"events",
						collectionEvent,
						{
							events: {
								changes: [
									{ kind: "delete", eventId: collectionEvent, itemIdentity: "collection-event" },
								],
							},
						},
					],
					"event delete": [
						"events",
						foreignEvent.eventId,
						{
							events: {
								changes: [
									{ kind: "delete", itemIdentity: "event-delete", eventId: foreignEvent.eventId },
								],
							},
						},
					],
					"root entity update": [
						"entity",
						foreignEntity,
						{
							entity: {
								name: "Taken",
								target: update,
								entitySchemaSlug: "record",
								properties: { name: "Taken" },
							},
						},
					],
					"entity merge from": [
						"entities.merges",
						foreignEntity,
						{
							entities: {
								merges: [
									{ mergeInto: ownEntity, mergeFrom: foreignEntity, entitySchemaSlug: "record" },
								],
							},
						},
					],
					"entity merge into": [
						"entities.merges",
						foreignEntity,
						{
							entities: {
								merges: [
									{ mergeFrom: ownEntity, mergeInto: foreignEntity, entitySchemaSlug: "record" },
								],
							},
						},
					],
					"entity update": [
						"entities.updates",
						foreignEntity,
						{
							entities: {
								updates: [
									{
										name: "Taken",
										target: update,
										entitySchemaSlug: "record",
										properties: { name: "Taken" },
									},
								],
							},
						},
					],
					"relationship delete": [
						"relationships",
						foreignEntity,
						{
							relationships: {
								deletes: [
									{
										relationshipSchemaSlug: "atomic-link",
										source: { kind: "existing", entityId: ownEntity },
										target: { kind: "existing", entityId: foreignEntity },
									},
								],
							},
						},
					],
					"event update": [
						"events",
						foreignEvent.eventId,
						{
							events: {
								changes: [
									{
										kind: "update",
										itemIdentity: "event-update",
										item: {
											eventId: foreignEvent.eventId,
											patch: { properties: { remove: [], set: { value: "Taken" } } },
										},
									},
								],
							},
						},
					],
					"relationship upsert": [
						"relationships",
						foreignEntity,
						{
							relationships: {
								upserts: [
									{
										properties: {},
										propertiesMode: "merge",
										relationshipSchemaSlug: "atomic-link",
										source: { kind: "existing", entityId: ownEntity },
										target: { kind: "existing", entityId: foreignEntity },
									},
								],
							},
						},
					],
					"event session": [
						"events",
						foreignEntity,
						{
							events: {
								changes: [
									{
										kind: "create",
										itemIdentity: "event",
										eventSchemaSlug: "changed",
										properties: { value: "Saved" },
										entity: { kind: "existing", entityId: ownEntity },
										session: { kind: "existing", entityId: foreignEntity },
									},
								],
							},
						},
					],
				};
				const outcomes: Record<string, unknown> = {};
				const expected: Record<string, unknown> = {
					"missing entity": { code: "conflict", conflict: "entity-not-found" },
					"another user's entity": { code: "conflict", conflict: "entity-not-found" },
					"another user's entity delete": { code: "conflict", conflict: "entity-not-found" },
					"another user's fold subject": { code: "conflict", conflict: "entity-not-found" },
					"another user's signal subject": { code: "conflict", conflict: "entity-not-found" },
				};
				const missing = EntityId.make(yield* randomUuid);
				attacks["missing entity"] = [
					"events",
					missing,
					{ events: eventCreate({ kind: "existing", entityId: missing }) },
				];
				for (const [name, [part, id, attack, principal]] of Object.entries(attacks)) {
					const error = yield* Effect.flip(
						Effect.flatMap(ScriptChanges, (scripts) =>
							Effect.flatMap(Schema.decodeEffect(ChangeSet)(attack), (changes) =>
								scripts.commitKeyed({
									changes,
									lane: "interactive",
									executionId: `foreign-${name}`,
									occurredAt: own.command.occurredAt,
									principal: principal ?? own.command.writeContext,
								}),
							),
						),
					);
					outcomes[name] = error._tag === "ScriptChangesRejected" ? error.reason : error;
					expected[name] ??= rejectedReference(part, `${id} belongs to another plugin`);
				}
				expect(outcomes).toEqual(expected);
			}),
		testTimeout,
	);

	test.effect(
		"rejects an own entity named under another of the plugin's schemas as an invalid change",
		() =>
			Effect.gen(function* () {
				const source = revisionPackage("mismatch", "fixture", "record");
				const [record] = source.manifest.entitySchemas;
				assert(record);
				const own = yield* fixture({
					...source,
					manifest: { ...source.manifest, entitySchemas: [record, { ...record, slug: "note" }] },
				});
				const ownEntity = targetOf(own);
				const [noteRow] = yield* (yield* EntitiesRepository).insertEntities([
					{
						userId,
						scope: "user",
						properties: {},
						name: "Own note",
						populatedAt: null,
						entitySchemaPluginId: own.pluginId,
						id: EntityId.make(yield* randomUuid),
						entitySchemaSlug: EntitySchemaSlug.make("note"),
					},
				]);
				assert(noteRow);
				const note = noteRow.id;
				const target = yield* Schema.decodeUnknownEffect(ChangeSetEntityUpdate.fields.target)({
					kind: "update",
					entityId: note,
					expected: yield* entityBaseline(own, note),
				});
				const update = {
					target,
					name: "Renamed",
					entitySchemaSlug: "record",
					properties: { name: "Renamed" },
				};
				const cases: Record<string, readonly [string, typeof ChangeSet.Encoded]> = {
					"root update": ["entity", { entity: update }],
					update: ["entities.updates", { entities: { updates: [update] } }],
					clear: [
						"entities.clears",
						{ entities: { clears: [{ entityId: note, entitySchemaSlug: "record" }] } },
					],
					delete: [
						"entities.deletes",
						{ entities: { deletes: [{ entityId: note, entitySchemaSlug: "record" }] } },
					],
					merge: [
						"entities.merges",
						{
							entities: {
								merges: [{ mergeFrom: note, mergeInto: ownEntity, entitySchemaSlug: "record" }],
							},
						},
					],
				};
				const outcomes: Record<string, unknown> = {};
				const expected: Record<string, unknown> = {};
				for (const [name, [part, changeSet]] of Object.entries(cases)) {
					const error = yield* Effect.flip(
						Effect.flatMap(ScriptChanges, (scripts) =>
							Effect.flatMap(Schema.decodeEffect(ChangeSet)(changeSet), (changes) =>
								scripts.commitKeyed({
									changes,
									lane: "interactive",
									executionId: `mismatch-${name}`,
									occurredAt: own.command.occurredAt,
									principal: own.command.writeContext,
								}),
							),
						),
					);
					outcomes[name] = error._tag === "ScriptChangesRejected" ? error.reason : error;
					expected[name] = rejectedReference(part, `${note} is not a record entity`);
				}
				expect(outcomes).toEqual(expected);
				expect(yield* entityBaseline(own, note)).toEqual(target.expected);
			}),
		testTimeout,
	);

	test.effect(
		"refuses a merge the user data rules forbid with its reason",
		() =>
			Effect.gen(function* () {
				const own = yield* fixture();
				const ownEntity = targetOf(own);
				const error = yield* Effect.flip(
					Effect.flatMap(ScriptChanges, (scripts) =>
						Effect.flatMap(
							Schema.decodeEffect(ChangeSet)({
								entities: {
									merges: [
										{ mergeFrom: ownEntity, mergeInto: ownEntity, entitySchemaSlug: "record" },
									],
								},
							}),
							(changes) =>
								scripts.commitKeyed({
									changes,
									lane: "interactive",
									executionId: "same-entity-merge",
									occurredAt: own.command.occurredAt,
									principal: own.command.writeContext,
								}),
						),
					),
				);
				assert(error._tag === "ScriptChangesRejected");
				expect(scriptChangesFailure(error)).toEqual({
					kind: "script-failure",
					code: "changes-refused",
					message: "The changes were refused",
					reason: kernelMessage("error.entity-user-data.same-entity-merge"),
				});
			}),
		testTimeout,
	);

	test.effect(
		"reports a policy that could not run as retryable and a failed policy script as invalid changes",
		() =>
			Effect.scoped(
				Effect.gen(function* () {
					const own = yield* fixture(
						policyPackage({ event: { properties: ["value"] } }, [
							{
								resource: "event",
								operation: "create",
								eventSchemaSlug: "changed",
								entitySchemaSlug: "record",
							},
						]),
					);
					const { match } = yield* LifecyclePolicies;
					const outcomes: Record<string, unknown> = {};
					for (const kind of [
						"resource-unavailable",
						"timeout",
						"infrastructure",
						"script-failure",
						"invalid-output",
					] as const) {
						const changeSets = yield* ChangeSets.make.pipe(
							Effect.provideService(
								LifecyclePolicies,
								LifecyclePolicies.of({
									match,
									run: () => Effect.fail(new AutomationPolicyExecutionError({ kind })),
								}),
							),
						);
						const scripts = Context.get(
							yield* Layer.build(Layer.fresh(ScriptChangesLayer)).pipe(
								Effect.provideService(ChangeSets, changeSets),
							),
							ScriptChanges,
						);
						const error = yield* Effect.flip(
							scripts.commitKeyed({
								lane: "interactive",
								executionId: `policy-${kind}`,
								occurredAt: own.command.occurredAt,
								principal: own.command.writeContext,
								changes: { ...own.input, relationships: {} },
							}),
						);
						assert(error._tag === "ScriptChangesRejected");
						const { code, kind: failureKind } = scriptChangesFailure(error);
						outcomes[kind] = { code, kind: failureKind };
					}
					const unavailable = { code: "policy-unavailable", kind: "resource-unavailable" };
					const invalid = { kind: "invalid-output", code: "changes-rejected" };
					expect(outcomes).toEqual({
						timeout: unavailable,
						"script-failure": invalid,
						"invalid-output": invalid,
						infrastructure: unavailable,
						"resource-unavailable": unavailable,
					});
				}),
			),
		testTimeout,
	);

	test.effect(
		"keeps script authority to script writers and script-only parts away from kernel writers",
		() =>
			Effect.gen(function* () {
				const own = yield* fixture();
				const foreign = yield* fixture(revisionPackage("foreign", "fixture", "record"));
				const foreignEntity = targetOf(foreign);
				const changeSets = yield* ChangeSets;
				const kernelCommand = { ...nextCommand(own), writeContext: null };
				const written = yield* changeSets.commit(
					eventCreateChanges(userId, [
						{
							entityId: foreignEntity,
							properties: { value: "Kernel" },
							eventSchemaSlug: EventSchemaSlug.make("changed"),
						},
					]),
					kernelCommand,
					{ events: { independent: true } },
				);
				expect(written.outcomes).toMatchObject([{ index: 0, status: "written" }]);
				expect(
					yield* Effect.flip(
						changeSets.commit({ userId, settings: { theme: "dark" } }, kernelCommand),
					),
				).toEqual(
					new ChangeSetRejected({ part: "settings", message: "settings requires a script writer" }),
				);
				const scripted = fromScriptChangeSet(
					{ entities: { deletes: [{ entityId: foreignEntity, entitySchemaSlug: "record" }] } },
					userId,
					own.pluginId,
					null,
				);
				expect(scripted.entities?.deletes?.[0]?.entitySchema).toEqual({
					owner: definitionOwner(own.pluginId),
					slug: EntitySchemaSlug.make("record"),
				});
			}),
		testTimeout,
	);
});
