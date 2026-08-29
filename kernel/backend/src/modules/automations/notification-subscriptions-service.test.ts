import { expect, it } from "@effect/vitest";
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
import { Effect, Layer, Schema } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
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

const mockRepository = Layer.mock(AutomationsRepository);
const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ ...overrides });

const makeDefinitions = (
	catalogState: "active" | "hidden" = "active",
	includeDefinition = true,
) => {
	const signals = includeDefinition ? [{ ...signalSchema, catalogState, pluginId: null }] : [];
	return Layer.mock(DefinitionRepository)({
		listUserSignalSchemas: () => Effect.succeed(signals),
		findUserSignalSchema: (_userId, slug) =>
			Effect.succeed(signals.find((signal) => signal.slug === slug) ?? null),
	});
};

const makeLayer = (
	repository: MockOverrides<typeof mockRepository> = {},
	catalogState: "active" | "hidden" = "active",
	includeDefinition = true,
) =>
	NotificationSubscriptionsService.layer.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				databaseLayer,
				makeDefinitions(catalogState, includeDefinition),
				makeRepository(repository),
			),
		),
	);

it.effect("installs an active catalog schema with only server-selected state fields", () => {
	let inserted: InsertNotificationSubscriptionInput | undefined;
	const layer = makeLayer({
		insertNotificationSubscription: (input) => {
			inserted = input;
			return Effect.succeed({ id: state.id });
		},
	});
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		const installed = yield* service.installRule({ userId, signalSchemaSlug });
		expect(installed).toEqual({ id: ruleId });
		expect(inserted).toEqual({
			userId,
			metadata: null,
			isActive: true,
			signalSchemaSlug,
			signalSchemaPluginId: null,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rejects hidden catalog schemas and duplicate installs", () => {
	const hiddenLayer = makeLayer({}, "hidden");
	const duplicateLayer = makeLayer({ insertNotificationSubscription: () => Effect.succeed(null) });
	return Effect.gen(function* () {
		const hidden = yield* Effect.exit(
			Effect.provide(
				Effect.flatMap(NotificationSubscriptionsService, (service) =>
					service.installRule({ userId, signalSchemaSlug }),
				),
				hiddenLayer,
			),
		);
		assertExitFails(
			hidden,
			new AutomationNotFoundError({
				reason: { signalSchemaSlug, code: "signal-schema-not-found" },
			}),
		);

		const duplicate = yield* Effect.exit(
			Effect.provide(
				Effect.flatMap(NotificationSubscriptionsService, (service) =>
					service.installRule({ userId, signalSchemaSlug }),
				),
				duplicateLayer,
			),
		);
		assertExitFails(
			duplicate,
			new AutomationConflictError({ reason: { signalSchemaSlug, code: "rule-already-installed" } }),
		);
	});
});

it.effect("does not reveal inaccessible notification subscription through mutations", () => {
	const layer = makeLayer({
		findNotificationSubscription: () => Effect.succeed(null),
		deleteNotificationSubscription: () => Effect.succeed(null),
		setNotificationSubscriptionActive: () => Effect.succeed(null),
	});
	return Effect.gen(function* () {
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
	}).pipe(Effect.provide(layer));
});

it.effect("does not mutate state whose signal definition is no longer registered", () => {
	let mutationAttempted = false;
	const layer = makeLayer(
		{
			findNotificationSubscription: () => Effect.succeed(state),
			setNotificationSubscriptionActive: () => {
				mutationAttempted = true;
				return Effect.succeed({ id: state.id });
			},
		},
		"active",
		false,
	);
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		assertExitFails(
			yield* Effect.exit(service.setRuleActive({ userId, ruleId, isActive: false })),
			new AutomationNotFoundError({ reason: { ruleId, code: "rule-not-found" } }),
		);
		expect(mutationAttempted).toBe(false);
	}).pipe(Effect.provide(layer));
});

it.effect("installs active defaults idempotently through conflict-do-nothing inserts", () => {
	const inserted: InsertNotificationSubscriptionInput[] = [];
	const layer = makeLayer({
		insertNotificationSubscription: (input) => {
			inserted.push(input);
			return Effect.succeed(inserted.length === 1 ? { id: state.id } : null);
		},
	});
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		yield* service.ensureDefaultRules(userId);
		yield* service.ensureDefaultRules(userId);
		expect(inserted).toHaveLength(2);
		expect(inserted[0]).toEqual(inserted[1]);
	}).pipe(Effect.provide(layer));
});

it.effect("deactivates, deletes, and reinstalls the same notification rule shape", () => {
	let nextId = 1;
	let currentState: StoredNotificationSubscription | null = null;
	const layer = makeLayer({
		findNotificationSubscription: () => Effect.succeed(currentState),
		deleteNotificationSubscription: () => {
			const deleted = currentState;
			currentState = null;
			return Effect.succeed(deleted ? { id: deleted.id } : null);
		},
		setNotificationSubscriptionActive: (input) => {
			currentState = currentState ? { ...currentState, isActive: input.isActive } : null;
			return Effect.succeed(currentState ? { id: currentState.id } : null);
		},
		insertNotificationSubscription: (input) => {
			currentState = {
				...state,
				...input,
				id: NotificationSubscriptionId.make(`rule-${nextId++}`),
			};
			return Effect.succeed({ id: currentState.id });
		},
	});
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		const installed = yield* service.installRule({ userId, signalSchemaSlug });
		const deactivated = yield* service.setRuleActive({
			userId,
			isActive: false,
			ruleId: installed.id,
		});
		expect(deactivated).toEqual({ id: installed.id });
		expect(currentState).toMatchObject({ isActive: false });

		const activated = yield* service.setRuleActive({
			userId,
			isActive: true,
			ruleId: installed.id,
		});
		expect(activated).toEqual({ id: installed.id });
		expect(currentState).toMatchObject({ isActive: true });
		expect(yield* service.deleteRule({ userId, ruleId: installed.id })).toEqual({
			id: installed.id,
		});

		const reinstalled = yield* service.installRule({ userId, signalSchemaSlug });
		expect(reinstalled.id).not.toBe(installed.id);
		expect(reinstalled).toEqual({ id: NotificationSubscriptionId.make("rule-2") });
		expect(currentState).toMatchObject({ isActive: true, signalSchemaSlug });
	}).pipe(Effect.provide(layer));
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
