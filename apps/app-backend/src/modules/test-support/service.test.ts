import { expect, it } from "@effect/vitest";
import {
	AutomationRuleId,
	EntityId,
	EntitySchemaId,
	SandboxScriptId,
	SignalSchemaId,
	UserId,
} from "@ryot/contract/schema/brands";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { transactionLayer } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { AutomationsService } from "#modules/automations/service";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasService } from "#modules/entity-schemas/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { RelationshipSchemasService } from "#modules/relationship-schemas/service";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxApiService } from "#modules/sandbox/service";
import { SignalSchemasService } from "#modules/signals/service";

import { TestSupportService } from "./service";

const entityId = EntityId.make("entity-id");
const scriptId = SandboxScriptId.make("script-id");
const entitySchemaId = EntitySchemaId.make("entity-schema-id");

const mockAuth = Layer.mock(AuthService);
const mockEntities = Layer.mock(EntitiesService);
const mockSandbox = Layer.mock(SandboxApiService);
const mockAutomations = Layer.mock(AutomationsService);
const mockTranslations = Layer.mock(TranslationsService);
const mockRelationships = Layer.mock(RelationshipsService);
const mockEntitySchemas = Layer.mock(EntitySchemasService);
const mockSignalSchemas = Layer.mock(SignalSchemasService);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemasService);

const makeServiceLayer = (
	overrides: {
		sandbox?: MockOverrides<typeof mockSandbox>;
		entities?: MockOverrides<typeof mockEntities>;
		automations?: MockOverrides<typeof mockAutomations>;
		relationships?: MockOverrides<typeof mockRelationships>;
		entitySchemas?: MockOverrides<typeof mockEntitySchemas>;
		signalSchemas?: MockOverrides<typeof mockSignalSchemas>;
	} = {},
) =>
	TestSupportService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				transactionLayer,
				mockAuth({ _tag: "AuthService", auth: Object.create(null) }),
				mockAutomations({ _tag: "AutomationsService", ...overrides.automations }),
				mockEntities({ _tag: "EntitiesService", ...overrides.entities }),
				mockSandbox({ _tag: "SandboxApiService", ...overrides.sandbox }),
				mockTranslations({ _tag: "TranslationsService" }),
				mockRelationships({ _tag: "RelationshipsService", ...overrides.relationships }),
				mockEntitySchemas({ _tag: "EntitySchemasService", ...overrides.entitySchemas }),
				mockRelationshipSchemas({ _tag: "RelationshipSchemasService" }),
				mockSignalSchemas({ _tag: "SignalSchemasService", ...overrides.signalSchemas }),
			),
		),
	);

it.effect("installs a built-in notification subscription through the automation service", () => {
	const userId = UserId.make("user-id");
	const signalSchemaId = SignalSchemaId.make("signal-schema-id");
	const ruleId = AutomationRuleId.make("automation-rule-id");
	let definition: unknown;
	const layer = makeServiceLayer({
		sandbox: {
			listStoredScripts: () =>
				Effect.succeed([
					{
						id: scriptId,
						source: "source",
						compiledFormat: 1,
						compiledCode: "compiled",
						name: "Signal Notification",
						slug: "automation.notification",
						metadata: {
							requiredAppConfigKeys: [],
							name: "Signal Notification",
							kind: "automation" as const,
							slug: "automation.notification",
							capabilities: ["sendNotification" as const],
						},
					},
				]),
		},
		signalSchemas: {
			getBuiltinBySlug: () =>
				Effect.succeed({
					id: signalSchemaId,
					userId: null,
					isBuiltin: true,
					name: "Review Created",
					slug: "review.created",
					catalogState: "active" as const,
					propertiesSchema: { fields: {} },
					audiencePolicy: { kind: "actor" as const },
				}),
		},
		automations: {
			createUserRule: (input) => {
				definition = input;
				return Effect.succeed({
					...input,
					id: ruleId,
					position: null,
					metadata: null,
					isActive: true,
					isBuiltin: false,
					createdAt: "2026-07-21T00:00:00.000Z",
					updatedAt: "2026-07-21T00:00:00.000Z",
				});
			},
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		expect(
			yield* service.installBuiltinNotificationSubscription({
				userId,
				signalSchemaSlug: "review.created",
			}),
		).toEqual({ id: ruleId });
		expect(definition).toEqual({
			userId,
			operation: "signal",
			kind: "subscription",
			name: "Review Created",
			sandboxScriptId: scriptId,
			target: { id: signalSchemaId, kind: "signal_schema" },
		});
	}).pipe(Effect.provide(layer));
});

it.effect("deletes script-owned rows in order and remains idempotent", () => {
	const calls: string[] = [];
	const layer = makeServiceLayer({
		relationships: {
			deleteTouchingEntitiesOfSandboxScript: () =>
				Effect.sync(() => {
					calls.push("relationships");
					return 0;
				}),
		},
		entities: {
			deleteBySandboxScript: () =>
				Effect.sync(() => {
					calls.push("entities");
					return 0;
				}),
		},
		entitySchemas: {
			deleteSandboxScriptLinks: () =>
				Effect.sync(() => {
					calls.push("links");
					return 0;
				}),
		},
		sandbox: {
			deleteStoredScript: () =>
				Effect.sync(() => {
					calls.push("script");
					return null;
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		expect(yield* service.deleteSandboxScript(scriptId)).toEqual({ id: scriptId });
		expect(yield* service.deleteSandboxScript(scriptId)).toEqual({ id: scriptId });
		expect(calls).toEqual([
			"relationships",
			"entities",
			"links",
			"script",
			"relationships",
			"entities",
			"links",
			"script",
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("updates populatedAt without changing entity fields", () => {
	const populatedAt = "2026-07-20T12:00:00.000Z";
	const populatedAtDate = dayjs(populatedAt).toDate();
	let updateInput: unknown;
	const entity = {
		id: entityId,
		name: "Entity",
		entitySchemaId,
		externalId: null,
		populatedAt: null,
		sandboxScriptId: null,
		createdAt: populatedAt,
		updatedAt: populatedAt,
		properties: { title: "Entity" },
	};
	const layer = makeServiceLayer({
		entities: {
			getByIdAnyScope: () => Effect.succeed(entity),
			update: (input) =>
				Effect.sync(() => {
					updateInput = input;
					return { ...entity, populatedAt };
				}),
		},
	});

	return Effect.gen(function* () {
		const service = yield* TestSupportService;
		yield* service.setEntityPopulatedAt(entityId, populatedAt);
		expect(updateInput).toEqual({
			entityId,
			entitySchemaId,
			name: entity.name,
			properties: entity.properties,
			populatedAt: populatedAtDate,
		});
	}).pipe(Effect.provide(layer));
});
