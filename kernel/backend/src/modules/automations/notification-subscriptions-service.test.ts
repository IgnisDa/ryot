import { expect, it, layer } from "@effect/vitest";
import {
	AutomationConflictError,
	AutomationNotFoundError,
	InstallNotificationRuleBody,
} from "@ryot-app/contract/modules/automations/schemas";
import {
	NotificationSubscriptionId,
	SandboxScriptId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import { databaseLayer } from "#lib/test-utils/effect";
import { DefinitionRepository } from "#modules/definition-registry/repository";

import { NotificationSubscriptionsService } from "./notification-subscriptions-service";
import {
	AutomationsRepository,
	type InsertNotificationSubscriptionInput,
	type StoredNotificationSubscription,
} from "./repository";

const userId = UserId.make("user-1");
const ruleId = NotificationSubscriptionId.make("rule-1");
const scriptId = SandboxScriptId.make("script-1");
const signalSchemaSlug = SignalSchemaSlug.make("review.created");

const signalSchema = {
	slug: signalSchemaSlug,
	catalogState: "active",
	name: "Review Created",
	audiencePolicy: { kind: "actor" },
	notificationHookSlug: "automation.notification",
	propertiesSchema: { fields: {}, unknownKeys: "strict" },
} as const;

const state = {
	userId,
	id: ruleId,
	metadata: null,
	isActive: true,
	signalSchemaSlug,
	signalSchemaPluginId: null,
	createdAt: "2026-07-21T10:00:00.000Z",
	updatedAt: "2026-07-21T10:00:00.000Z",
} as const satisfies StoredNotificationSubscription;

type CatalogState = "active" | "hidden";
type ActiveChange = Parameters<
	AutomationsRepository["Service"]["setNotificationSubscriptionActive"]
>[0];

class NotificationStore extends Context.Service<
	NotificationStore,
	{
		readonly subscription: Effect.Effect<StoredNotificationSubscription | null>;
		readonly inserts: Effect.Effect<ReadonlyArray<InsertNotificationSubscriptionInput>>;
		readonly activeChanges: Effect.Effect<ReadonlyArray<ActiveChange>>;
		readonly setCatalogState: (catalogState: CatalogState) => Effect.Effect<void>;
	}
>()("test/NotificationStore") {}

const notificationStoreLayer = (
	options: {
		readonly initial?: StoredNotificationSubscription;
		readonly catalogState?: CatalogState;
		readonly includeDefinition?: boolean;
	} = {},
) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const subscription = yield* Ref.make<StoredNotificationSubscription | null>(
				options.initial ?? null,
			);
			const inserts = yield* Ref.make<ReadonlyArray<InsertNotificationSubscriptionInput>>([]);
			const activeChanges = yield* Ref.make<ReadonlyArray<ActiveChange>>([]);
			const catalogState = yield* Ref.make(options.catalogState ?? "active");
			const signals = Effect.map(Ref.get(catalogState), (current) =>
				(options.includeDefinition ?? true)
					? [{ ...signalSchema, pluginId: null, catalogState: current }]
					: [],
			);
			const owned = (input: { userId: UserId; ruleId: NotificationSubscriptionId }) =>
				Effect.map(Ref.get(subscription), (current) =>
					current?.id === input.ruleId && current.userId === input.userId ? current : null,
				);
			return Layer.mergeAll(
				Layer.mock(DefinitionRepository)({
					listUserSignalSchemas: () => signals,
					findUserSignalSchema: (_userId, slug) =>
						Effect.map(signals, (all) => all.find((signal) => signal.slug === slug) ?? null),
				}),
				Layer.mock(AutomationsRepository)({
					findNotificationSubscription: owned,
					deleteNotificationSubscription: (input) =>
						Effect.gen(function* () {
							const current = yield* owned(input);
							if (!current) {
								return null;
							}
							yield* Ref.set(subscription, null);
							return { id: current.id };
						}),
					setNotificationSubscriptionActive: (input) =>
						Effect.gen(function* () {
							yield* Ref.update(activeChanges, (all) => [...all, input]);
							const current = yield* owned(input);
							if (!current) {
								return null;
							}
							yield* Ref.set(subscription, { ...current, isActive: input.isActive });
							return { id: current.id };
						}),
					insertNotificationSubscription: (input) =>
						Effect.gen(function* () {
							const inserted = yield* Ref.updateAndGet(inserts, (all) => [...all, input]);
							if ((yield* Ref.get(subscription))?.signalSchemaSlug === input.signalSchemaSlug) {
								return null;
							}
							const id = NotificationSubscriptionId.make(`rule-${inserted.length}`);
							yield* Ref.set(subscription, { ...state, ...input, id });
							return { id };
						}),
				}),
				Layer.succeed(NotificationStore, {
					inserts: Ref.get(inserts),
					subscription: Ref.get(subscription),
					activeChanges: Ref.get(activeChanges),
					setCatalogState: (next) => Ref.set(catalogState, next),
				}),
			);
		}),
	);

const makeLayer = (options?: Parameters<typeof notificationStoreLayer>[0]) =>
	NotificationSubscriptionsService.layer.pipe(
		Layer.provideMerge(Layer.merge(databaseLayer, notificationStoreLayer(options))),
	);

layer(makeLayer())((test) => {
	test.effect("installs an active catalog schema with only server-selected state fields", () =>
		Effect.gen(function* () {
			const service = yield* NotificationSubscriptionsService;
			const installed = yield* service.installRule({ userId, signalSchemaSlug });
			expect(installed).toEqual({ id: ruleId });
			expect(yield* (yield* NotificationStore).inserts).toEqual([
				{ userId, metadata: null, isActive: true, signalSchemaSlug, signalSchemaPluginId: null },
			]);
		}),
	);
});

layer(makeLayer({ initial: state, catalogState: "hidden" }))((test) => {
	test.effect("rejects hidden catalog schemas and duplicate installs", () =>
		Effect.gen(function* () {
			const service = yield* NotificationSubscriptionsService;
			const hidden = yield* Effect.exit(service.installRule({ userId, signalSchemaSlug }));
			assertExitFails(
				hidden,
				new AutomationNotFoundError({
					reason: { signalSchemaSlug, code: "signal-schema-not-found" },
				}),
			);

			yield* (yield* NotificationStore).setCatalogState("active");
			const duplicate = yield* Effect.exit(service.installRule({ userId, signalSchemaSlug }));
			assertExitFails(
				duplicate,
				new AutomationConflictError({
					reason: { signalSchemaSlug, code: "rule-already-installed" },
				}),
			);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("does not reveal inaccessible notification subscription through mutations", () =>
		Effect.gen(function* () {
			const service = yield* NotificationSubscriptionsService;
			for (const mutation of [
				service.setRuleActive({ userId, ruleId, isActive: false }),
				service.setRuleActive({ userId, ruleId, isActive: true }),
				service.deleteRule({ userId, ruleId }),
			]) {
				assertExitFails(
					yield* Effect.exit(mutation),
					new AutomationNotFoundError({ reason: { ruleId, code: "rule-not-found" } }),
				);
			}
		}),
	);
});

layer(makeLayer({ initial: state, includeDefinition: false }))((test) => {
	test.effect("does not mutate state whose signal definition is no longer registered", () =>
		Effect.gen(function* () {
			const service = yield* NotificationSubscriptionsService;
			assertExitFails(
				yield* Effect.exit(service.setRuleActive({ userId, ruleId, isActive: false })),
				new AutomationNotFoundError({ reason: { ruleId, code: "rule-not-found" } }),
			);
			expect(yield* (yield* NotificationStore).activeChanges).toEqual([]);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("installs active defaults idempotently through conflict-do-nothing inserts", () =>
		Effect.gen(function* () {
			const service = yield* NotificationSubscriptionsService;
			yield* service.ensureDefaultRules(userId);
			yield* service.ensureDefaultRules(userId);
			const inserted = yield* (yield* NotificationStore).inserts;
			expect(inserted).toHaveLength(2);
			expect(inserted[0]).toEqual(inserted[1]);
		}),
	);
});

layer(makeLayer())((test) => {
	test.effect("deactivates, deletes, and reinstalls the same notification rule shape", () =>
		Effect.gen(function* () {
			const service = yield* NotificationSubscriptionsService;
			const { subscription } = yield* NotificationStore;
			const installed = yield* service.installRule({ userId, signalSchemaSlug });
			const deactivated = yield* service.setRuleActive({
				userId,
				isActive: false,
				ruleId: installed.id,
			});
			expect(deactivated).toEqual({ id: installed.id });
			expect(yield* subscription).toMatchObject({ isActive: false });

			const activated = yield* service.setRuleActive({
				userId,
				isActive: true,
				ruleId: installed.id,
			});
			expect(activated).toEqual({ id: installed.id });
			expect(yield* subscription).toMatchObject({ isActive: true });
			expect(yield* service.deleteRule({ userId, ruleId: installed.id })).toEqual({
				id: installed.id,
			});

			const reinstalled = yield* service.installRule({ userId, signalSchemaSlug });
			expect(reinstalled.id).not.toBe(installed.id);
			expect(reinstalled).toEqual({ id: NotificationSubscriptionId.make("rule-2") });
			expect(yield* subscription).toMatchObject({ isActive: true, signalSchemaSlug });
		}),
	);
});

it("rejects arbitrary fields in the public install payload", () => {
	expect(() =>
		Schema.decodeUnknownSync(InstallNotificationRuleBody)({
			scriptId,
			signalSchemaSlug,
			operation: "signal",
		}),
	).toThrow();
});
