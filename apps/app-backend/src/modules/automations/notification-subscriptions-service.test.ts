import { expect, it } from "@effect/vitest";
import { Conflict, NotFound } from "@ryot/contract/errors";
import { InstallNotificationRuleBody } from "@ryot/contract/modules/automations/schemas";
import {
	AutomationRuleId,
	SandboxScriptId,
	SignalSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import { Effect, Exit, Layer, Schema } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer, transactionLayer } from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { NotificationSubscriptionsService } from "./notification-subscriptions-service";
import {
	AutomationsRepository,
	type InsertNotificationSubscriptionInput,
	type StoredNotificationSubscription,
} from "./repository";

const userId = UserId.make("user-1");
const ruleId = AutomationRuleId.make("rule-1");
const scriptId = SandboxScriptId.make("script-1");
const signalSchemaSlug = SignalSchemaSlug.make("review.created");
const kernelScript = {
	id: scriptId,
	userId: null,
	pluginSlug: null,
	compiledFormat: 1,
	contentHash: "hash-1",
	source: "export {};",
	compiledCode: "export {};",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	name: "Notification delivery",
	slug: "automation.notification",
	metadata: { kind: "automation" as const },
};

const signalSchema = {
	slug: signalSchemaSlug,
	catalogState: "active",
	name: "Review Created",
	audiencePolicy: { kind: "actor" },
	notificationScriptSlug: "automation.notification",
	propertiesSchema: { unknownKeys: "strict", fields: {} },
} as const;

const state = {
	userId,
	id: ruleId,
	metadata: null,
	isActive: true,
	signalSchemaSlug,
	createdAt: "2026-07-21T10:00:00.000Z",
	updatedAt: "2026-07-21T10:00:00.000Z",
} as const satisfies StoredNotificationSubscription;

const mockRepository = Layer.mock(AutomationsRepository);
const mockPluginRuntime = Layer.mock(PluginRuntimeResolver);
const makeRepository = (overrides: MockOverrides<typeof mockRepository> = {}) =>
	mockRepository({ _tag: "AutomationsRepository", ...overrides });
const makePluginRuntime = (overrides: MockOverrides<typeof mockPluginRuntime> = {}) =>
	mockPluginRuntime({
		_tag: "PluginRuntimeResolver",
		findActiveScript: () => Effect.succeed(null),
		findKernelScript: (slug) => {
			expect(slug).toBe(signalSchema.notificationScriptSlug);
			return Effect.succeed(kernelScript);
		},
		...overrides,
	});

const makeDefinitions = (
	catalogState: "active" | "hidden" = "active",
	includeDefinition = true,
) => {
	const registry = makeDefinitionRegistry({
		savedViews: [],
		entitySchemas: [],
		relationshipSchemas: [],
		signalSchemas: includeDefinition ? [{ ...signalSchema, catalogState }] : [],
	});
	return Layer.succeed(DefinitionRegistry, { _tag: "DefinitionRegistry", ...registry });
};

const makeLayer = (
	repository: MockOverrides<typeof mockRepository> = {},
	catalogState: "active" | "hidden" = "active",
	pluginRuntime: MockOverrides<typeof mockPluginRuntime> = {},
	includeDefinition = true,
) =>
	NotificationSubscriptionsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeDefinitions(catalogState, includeDefinition),
				makeRepository(repository),
				makePluginRuntime(pluginRuntime),
			),
		),
	);

it.effect("lists only active signal schemas supplied by the definition registry", () => {
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		expect(yield* service.listCatalog()).toEqual([
			{
				id: signalSchemaSlug,
				name: signalSchema.name,
				slug: signalSchema.slug,
				propertiesSchema: signalSchema.propertiesSchema,
			},
		]);
	}).pipe(Effect.provide(makeLayer()));
});

it.effect("installs an active catalog schema with only server-selected state fields", () => {
	let inserted: InsertNotificationSubscriptionInput | undefined;
	const layer = makeLayer({
		insertNotificationSubscription: (input) => {
			inserted = input;
			return Effect.succeed(state);
		},
	});
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		const installed = yield* service.installRule({ userId, signalSchemaSlug });
		expect(installed.id).toBe(ruleId);
		expect(inserted).toEqual({
			userId,
			metadata: null,
			isActive: true,
			signalSchemaSlug,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rejects hidden catalog schemas and duplicate installs", () => {
	const hiddenLayer = makeLayer({}, "hidden");
	const duplicateLayer = makeLayer({
		insertNotificationSubscription: () => Effect.succeed(null),
	});
	return Effect.gen(function* () {
		const hidden = yield* Effect.exit(
			Effect.provide(
				Effect.flatMap(NotificationSubscriptionsService, (service) =>
					service.installRule({ userId, signalSchemaSlug }),
				),
				hiddenLayer,
			),
		);
		expect(hidden).toEqual(Exit.fail(new NotFound({ message: "Signal schema not found" })));

		const duplicate = yield* Effect.exit(
			Effect.provide(
				Effect.flatMap(NotificationSubscriptionsService, (service) =>
					service.installRule({ userId, signalSchemaSlug }),
				),
				duplicateLayer,
			),
		);
		expect(duplicate).toEqual(
			Exit.fail(new Conflict({ message: "Notification rule already installed" })),
		);
	});
});

it.effect("returns the same not-found result for inaccessible and nonexistent rules", () => {
	const layer = makeLayer({ findNotificationSubscription: () => Effect.succeed(null) });
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		for (const inaccessibleRuleId of [ruleId, AutomationRuleId.make("missing")]) {
			expect(yield* Effect.exit(service.getRule({ userId, ruleId: inaccessibleRuleId }))).toEqual(
				Exit.fail(new NotFound({ message: "Automation rule not found" })),
			);
		}
	}).pipe(Effect.provide(layer));
});

it.effect("does not reveal inaccessible notification state through mutations", () => {
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
			expect(yield* Effect.exit(mutation)).toEqual(
				Exit.fail(new NotFound({ message: "Automation rule not found" })),
			);
		}
	}).pipe(Effect.provide(layer));
});

it.effect("omits state with a missing formatter and only permits explicit deletion", () => {
	let deleted = false;
	let mutationAttempted = false;
	const layer = makeLayer(
		{
			listNotificationSubscriptions: () => Effect.succeed([state]),
			findNotificationSubscription: () => Effect.succeed(state),
			setNotificationSubscriptionActive: () => {
				mutationAttempted = true;
				return Effect.succeed(state);
			},
			deleteNotificationSubscription: () => {
				deleted = true;
				return Effect.succeed({ id: state.id });
			},
		},
		"active",
		{ findKernelScript: () => Effect.succeed(null) },
	);
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		expect(yield* service.listRules(userId)).toEqual([]);
		expect(yield* Effect.exit(service.getRule({ userId, ruleId }))).toEqual(
			Exit.fail(new NotFound({ message: "Automation rule not found" })),
		);
		expect(yield* Effect.exit(service.setRuleActive({ userId, ruleId, isActive: false }))).toEqual(
			Exit.fail(new NotFound({ message: "Automation rule not found" })),
		);
		expect(mutationAttempted).toBe(false);
		expect(yield* service.deleteRule({ userId, ruleId })).toEqual({ id: ruleId });
		expect(deleted).toBe(true);
	}).pipe(Effect.provide(layer));
});

it.effect("omits state whose signal definition is no longer registered", () => {
	const layer = makeLayer(
		{
			listNotificationSubscriptions: () => Effect.succeed([state]),
			findNotificationSubscription: () => Effect.succeed(state),
		},
		"active",
		{},
		false,
	);
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		expect(yield* service.listRules(userId)).toEqual([]);
		expect(yield* Effect.exit(service.getRule({ userId, ruleId }))).toEqual(
			Exit.fail(new NotFound({ message: "Automation rule not found" })),
		);
	}).pipe(Effect.provide(layer));
});

it.effect("installs active defaults idempotently through conflict-do-nothing inserts", () => {
	const inserted: InsertNotificationSubscriptionInput[] = [];
	const layer = makeLayer({
		insertNotificationSubscription: (input) => {
			inserted.push(input);
			return Effect.succeed(inserted.length === 1 ? state : null);
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
		setNotificationSubscriptionActive: (input) => {
			currentState = currentState ? { ...currentState, isActive: input.isActive } : null;
			return Effect.succeed(currentState);
		},
		deleteNotificationSubscription: () => {
			const deleted = currentState;
			currentState = null;
			return Effect.succeed(deleted ? { id: deleted.id } : null);
		},
		insertNotificationSubscription: (input) => {
			currentState = {
				...state,
				...input,
				id: AutomationRuleId.make(`rule-${nextId++}`),
			};
			return Effect.succeed(currentState);
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
		expect(deactivated.isActive).toBe(false);

		const activated = yield* service.setRuleActive({
			userId,
			isActive: true,
			ruleId: installed.id,
		});
		expect(activated.isActive).toBe(true);
		expect(yield* service.deleteRule({ userId, ruleId: installed.id })).toEqual({
			id: installed.id,
		});

		const reinstalled = yield* service.installRule({ userId, signalSchemaSlug });
		expect(reinstalled.id).not.toBe(installed.id);
		expect(reinstalled.name).toBe(installed.name);
		expect(reinstalled.isActive).toBe(true);
		expect(reinstalled.signalSchema).toEqual(installed.signalSchema);
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
