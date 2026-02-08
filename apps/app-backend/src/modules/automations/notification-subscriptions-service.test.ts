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
import {
	SignalSchemasRepository,
	type SignalSchemaScope,
} from "#modules/signals/signal-schemas-repository";

import {
	NotificationSubscriptionsService,
	NOTIFICATION_SCRIPT_SLUG,
} from "./notification-subscriptions-service";
import {
	AutomationsRepository,
	type InsertAutomationRuleInput,
	type StoredAutomationRule,
} from "./repository";
import { AutomationsService } from "./service";

const userId = UserId.make("user-1");
const ruleId = AutomationRuleId.make("rule-1");
const scriptId = SandboxScriptId.make("script-1");
const signalSchemaSlug = SignalSchemaSlug.make("signal-schema-1");

const signalSchema = {
	userId: null,
	isBuiltin: true,
	id: signalSchemaSlug,
	catalogState: "active",
	slug: "review.created",
	name: "Review Created",
	audiencePolicy: { kind: "actor" },
	propertiesSchema: { unknownKeys: "strict", fields: {} },
} as const satisfies SignalSchemaScope;

const rule = {
	userId,
	id: ruleId,
	position: null,
	metadata: null,
	isActive: true,
	isBuiltin: false,
	operation: "signal",
	kind: "subscription",
	name: signalSchema.name,
	sandboxScriptId: scriptId,
	createdAt: "2026-07-21T10:00:00.000Z",
	updatedAt: "2026-07-21T10:00:00.000Z",
	target: { id: signalSchemaSlug, kind: "signal_schema" },
} as const satisfies StoredAutomationRule;

const mockAutomationsService = Layer.mock(AutomationsService);
const mockAutomationsRepository = Layer.mock(AutomationsRepository);
const mockSignalSchemasRepository = Layer.mock(SignalSchemasRepository);

const makeAutomationsRepository = (
	overrides: MockOverrides<typeof mockAutomationsRepository> = {},
) => mockAutomationsRepository({ _tag: "AutomationsRepository", ...overrides });

const makeSignalSchemasRepository = (
	overrides: MockOverrides<typeof mockSignalSchemasRepository> = {},
) => mockSignalSchemasRepository({ _tag: "SignalSchemasRepository", ...overrides });

const makeAutomationsService = (overrides: MockOverrides<typeof mockAutomationsService> = {}) =>
	mockAutomationsService({ _tag: "AutomationsService", ...overrides });

const makeLayer = (input?: {
	automations?: MockOverrides<typeof mockAutomationsService>;
	repository?: MockOverrides<typeof mockAutomationsRepository>;
	signalSchemas?: MockOverrides<typeof mockSignalSchemasRepository>;
}) =>
	NotificationSubscriptionsService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				dbRunnerLayer,
				transactionLayer,
				makeAutomationsService(input?.automations),
				makeAutomationsRepository(input?.repository),
				makeSignalSchemasRepository(input?.signalSchemas),
			),
		),
	);

it.effect(
	"lists only the active built-in signal schemas supplied by the catalog repository",
	() => {
		const layer = makeLayer({
			signalSchemas: { listActiveBuiltins: () => Effect.succeed([signalSchema]) },
		});
		return Effect.gen(function* () {
			const service = yield* NotificationSubscriptionsService;
			expect(yield* service.listCatalog()).toEqual([
				{
					id: signalSchema.id,
					name: signalSchema.name,
					slug: signalSchema.slug,
					propertiesSchema: signalSchema.propertiesSchema,
				},
			]);
		}).pipe(Effect.provide(layer));
	},
);

it.effect("installs an active catalog schema with only server-selected rule fields", () => {
	let inserted: InsertAutomationRuleInput | undefined;
	const layer = makeLayer({
		repository: {
			findBuiltinScriptBySlug: (slug) => {
				expect(slug).toBe(NOTIFICATION_SCRIPT_SLUG);
				return Effect.succeed({ id: scriptId });
			},
			insertRule: (input) => {
				inserted = input;
				return Effect.succeed(rule);
			},
		},
		signalSchemas: { findActiveBuiltinById: () => Effect.succeed(signalSchema) },
	});
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		const installed = yield* service.installRule({ userId, signalSchemaSlug });
		expect(installed.id).toBe(ruleId);
		expect(inserted).toEqual({
			userId,
			position: null,
			metadata: null,
			isActive: true,
			isBuiltin: false,
			operation: "signal",
			kind: "subscription",
			name: signalSchema.name,
			sandboxScriptId: scriptId,
			target: { id: signalSchemaSlug, kind: "signal_schema" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("rejects hidden catalog schemas and duplicate installs", () => {
	const hiddenLayer = makeLayer({
		signalSchemas: { findActiveBuiltinById: () => Effect.succeed(null) },
	});
	const duplicateLayer = makeLayer({
		repository: {
			insertRule: () => Effect.succeed(null),
			findBuiltinScriptBySlug: () => Effect.succeed({ id: scriptId }),
		},
		signalSchemas: { findActiveBuiltinById: () => Effect.succeed(signalSchema) },
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
	const layer = makeLayer({
		repository: {
			findBuiltinScriptBySlug: () => Effect.succeed({ id: scriptId }),
			findUserNotificationRule: () => Effect.succeed(null),
		},
	});
	return Effect.gen(function* () {
		const service = yield* NotificationSubscriptionsService;
		for (const inaccessibleRuleId of [ruleId, AutomationRuleId.make("missing")]) {
			expect(yield* Effect.exit(service.getRule({ userId, ruleId: inaccessibleRuleId }))).toEqual(
				Exit.fail(new NotFound({ message: "Automation rule not found" })),
			);
		}
	}).pipe(Effect.provide(layer));
});

it.effect("installs active defaults idempotently through conflict-do-nothing inserts", () => {
	const inserted: InsertAutomationRuleInput[] = [];
	const layer = makeLayer({
		repository: {
			findBuiltinScriptBySlug: () => Effect.succeed({ id: scriptId }),
			insertRule: (input) => {
				inserted.push(input);
				return Effect.succeed(inserted.length === 1 ? rule : null);
			},
		},
		signalSchemas: { listActiveBuiltins: () => Effect.succeed([signalSchema]) },
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
	let currentRule: StoredAutomationRule | null = null;
	const layer = makeLayer({
		automations: {
			deleteUserRule: () => {
				const deleted = currentRule;
				currentRule = null;
				return deleted ? Effect.succeed({ id: deleted.id }) : Effect.die("missing rule");
			},
			setUserRuleActive: (input) => {
				currentRule = currentRule ? { ...currentRule, isActive: input.isActive } : null;
				return currentRule ? Effect.succeed(currentRule) : Effect.die("missing rule");
			},
		},
		repository: {
			findBuiltinScriptBySlug: () => Effect.succeed({ id: scriptId }),
			findUserNotificationRule: () => Effect.succeed(currentRule),
			insertRule: (input) => {
				currentRule = {
					...rule,
					...input,
					id: AutomationRuleId.make(`rule-${nextId++}`),
				};
				return Effect.succeed(currentRule);
			},
		},
		signalSchemas: {
			findBuiltinById: () => Effect.succeed(signalSchema),
			findActiveBuiltinById: () => Effect.succeed(signalSchema),
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
