import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { EntityId, EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { Effect, Layer } from "effect";

import type { MockOverrides } from "#lib/test-utils/effect";
import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { AuthService } from "#modules/auth/service";
import { AutomationsService } from "#modules/automations/service";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxApiService } from "#modules/sandbox/service";
import { SignalsService } from "#modules/signals/service";

import { TestSupportService } from "./service";

const entityId = EntityId.make("entity-id");
const entitySchemaSlug = EntitySchemaSlug.make("entity-schema-id");

const mockAuth = Layer.mock(AuthService);
const mockSignals = Layer.mock(SignalsService);
const mockEntities = Layer.mock(EntitiesService);
const mockInterest = Layer.mock(InterestService);
const mockSandbox = Layer.mock(SandboxApiService);
const mockAutomations = Layer.mock(AutomationsService);
const mockTranslations = Layer.mock(TranslationsService);
const mockRelationships = Layer.mock(RelationshipsService);
const mockRelationshipSchemas = Layer.mock(RelationshipSchemasRepository);
const workflowEngineLayer = Layer.succeed(
	WorkflowEngine,
	makeWorkflowEngine({ execute: () => Effect.void.pipe(Effect.as(undefined)) }),
);

const makeServiceLayer = (
	overrides: {
		sandbox?: MockOverrides<typeof mockSandbox>;
		entities?: MockOverrides<typeof mockEntities>;
	} = {},
	definitions = makeDefinitionRegistry(),
) => {
	return TestSupportService.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				mockAuth({ _tag: "AuthService", auth: Object.create(null) }),
				mockAutomations({ _tag: "AutomationsService" }),
				mockSignals({ _tag: "SignalsService" }),
				Layer.succeed(DefinitionRegistry, { _tag: "DefinitionRegistry", ...definitions }),
				mockEntities({ _tag: "EntitiesService", ...overrides.entities }),
				mockSandbox({ _tag: "SandboxApiService", ...overrides.sandbox }),
				mockInterest({ _tag: "InterestService" }),
				mockTranslations({ _tag: "TranslationsService" }),
				mockRelationships({ _tag: "RelationshipsService" }),
				mockRelationshipSchemas({ _tag: "RelationshipSchemasRepository" }),
				workflowEngineLayer,
			),
		),
	);
};

it.effect("updates populatedAt without changing entity fields", () => {
	const populatedAt = "2026-07-20T12:00:00.000Z";
	const populatedAtDate = dayjs(populatedAt).toDate();
	let updateInput: unknown;
	const entity = {
		id: entityId,
		name: "Entity",
		entitySchemaSlug,
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
			entitySchemaSlug,
			name: entity.name,
			populatedAt: populatedAtDate,
			properties: entity.properties,
		});
	}).pipe(Effect.provide(layer));
});
