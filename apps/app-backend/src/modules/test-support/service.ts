import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { badRequest, unknownToMessage } from "@ryot/contract/errors";
import type { TestSupportInstallDefinitions } from "@ryot/contract/modules/test-support/schemas";
import {
	EntitySchemaSlug,
	type EntityId,
	type RelationshipSchemaSlug,
	type SandboxScriptId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";

import { TransactionRunner } from "#lib/infrastructure/db/service";
import { AuthService } from "#modules/auth/service";
import { AutomationsService } from "#modules/automations/service";
import {
	DefinitionRegistry,
	definitionSourceFromSnapshot,
} from "#modules/definition-registry/service";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { EntitySchemasRepository } from "#modules/entity-schemas/repository";
import { TranslationsService } from "#modules/entity-translation/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxApiService } from "#modules/sandbox/service";
import { InfrequentCronWorkflow } from "#modules/scheduler/cron-workflow";
import { SignalsService } from "#modules/signals/service";

type CreateGlobalEntityInput = {
	readonly name: string;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly externalId?: string | undefined;
	readonly properties: Record<string, unknown>;
	readonly populatedAt?: string | null | undefined;
	readonly sandboxScriptId?: SandboxScriptId | undefined;
};

const parseDate = (value: string) => {
	const parsed = dayjs(value);
	return parsed.isValid()
		? Effect.succeed(parsed.toDate())
		: Effect.fail(badRequest("populatedAt must be a valid ISO 8601 date"));
};

const mergeBySlug = <Definition extends { readonly slug: string }>(
	current: ReadonlyArray<Definition>,
	additions: ReadonlyArray<Definition> | undefined,
) => {
	const merged = new Map(current.map((definition) => [definition.slug, definition]));
	for (const definition of additions ?? []) {
		merged.set(definition.slug, definition);
	}
	return [...merged.values()];
};

export class TestSupportService extends Effect.Service<TestSupportService>()("TestSupportService", {
	effect: Effect.gen(function* () {
		const auth = yield* AuthService;
		const engine = yield* WorkflowEngine;
		const signals = yield* SignalsService;
		const entities = yield* EntitiesService;
		const definitions = yield* DefinitionRegistry;
		const interest = yield* InterestService;
		const sandbox = yield* SandboxApiService;
		const automations = yield* AutomationsService;
		const translations = yield* TranslationsService;
		const relationships = yield* RelationshipsService;
		const entitySchemas = yield* EntitySchemasRepository;
		const runInTransaction = yield* TransactionRunner;
		const relationshipSchemas = yield* RelationshipSchemasRepository;

		const installDefinitions = Effect.fn("TestSupportService.installDefinitions")(function* (
			input: TestSupportInstallDefinitions,
		) {
			const current = definitionSourceFromSnapshot(definitions.getSnapshot());
			const trackers = input.trackers?.map((tracker) => ({
				icon: tracker.icon,
				name: tracker.name,
				slug: tracker.slug,
				accentColor: tracker.accentColor,
				description: tracker.description ?? "",
				entitySchemaSlugs: tracker.entitySchemaSlugs,
			}));
			const installedEntitySchemas = input.entitySchemas?.map((entitySchema) =>
				Object.assign({}, entitySchema, { isBuiltin: false }),
			);
			yield* Effect.try({
				try: () =>
					definitions.replace({
						...current,
						trackers: mergeBySlug(current.trackers, trackers),
						entitySchemas: mergeBySlug(current.entitySchemas, installedEntitySchemas),
						relationshipSchemas: mergeBySlug(
							current.relationshipSchemas,
							input.relationshipSchemas,
						),
					}),
				catch: (cause) => badRequest(unknownToMessage(cause)),
			});
		});

		const deleteSandboxScript = Effect.fn("TestSupportService.deleteSandboxScript")(function* (
			scriptId: SandboxScriptId,
		) {
			yield* runInTransaction(
				Effect.gen(function* () {
					yield* relationships.deleteTouchingEntitiesOfSandboxScript(scriptId);
					yield* entities.deleteBySandboxScript(scriptId);
					yield* entitySchemas.deleteSandboxScriptLinks(scriptId);
					yield* sandbox.deleteStoredScript(scriptId);
				}),
			);
			return { id: scriptId };
		});

		const createGlobalEntity = Effect.fn("TestSupportService.createGlobalEntity")(function* (
			input: CreateGlobalEntityInput,
		) {
			const created = yield* entities.createGlobal({
				name: input.name,
				populatedAt: null,
				properties: input.properties,
				externalId: input.externalId,
				entitySchemaSlug: input.entitySchemaSlug,
				sandboxScriptId: input.sandboxScriptId,
			});
			if (input.populatedAt === undefined) {
				return created;
			}
			return yield* entities.update({
				name: created.name,
				entityId: created.id,
				properties: created.properties,
				entitySchemaSlug: created.entitySchemaSlug,
				populatedAt: input.populatedAt === null ? null : yield* parseDate(input.populatedAt),
			});
		});

		const setEntityPopulatedAt = Effect.fn("TestSupportService.setEntityPopulatedAt")(function* (
			entityId: EntityId,
			populatedAt: string | null,
		) {
			const entity = yield* entities.getByIdAnyScope(entityId);
			return yield* entities.update({
				entityId,
				name: entity.name,
				properties: entity.properties,
				entitySchemaSlug: entity.entitySchemaSlug,
				populatedAt: populatedAt === null ? null : yield* parseDate(populatedAt),
			});
		});

		const upsertGlobalRelationship = Effect.fn("TestSupportService.upsertGlobalRelationship")(
			function* (input: {
				sourceEntityId: EntityId;
				targetEntityId: EntityId;
				relationshipSchemaSlug: RelationshipSchemaSlug;
				properties?: Record<string, unknown> | undefined;
			}) {
				const relationshipSchema = yield* relationshipSchemas.findById(
					input.relationshipSchemaSlug,
					null,
				);
				if (!relationshipSchema) {
					return yield* badRequest("Relationship schema not found");
				}
				return yield* relationships.create({
					scope: "global",
					properties: input.properties ?? {},
					sourceEntityId: input.sourceEntityId,
					targetEntityId: input.targetEntityId,
					relationshipSchemaSlug: input.relationshipSchemaSlug,
					propertiesSchema: relationshipSchema.propertiesSchema,
				});
			},
		);

		const linkAuthAccount = Effect.fn("TestSupportService.linkAuthAccount")(function* (input: {
			userId: UserId;
			accountId: string;
			providerId: string;
		}) {
			const id = generateId();
			yield* auth.linkAuthAccount({ id, ...input });
			return { id };
		});

		const upsertEntityTranslation = Effect.fn("TestSupportService.upsertEntityTranslation")(
			function* (input: {
				language: string;
				entityId: EntityId;
				name: string | null;
				properties: Record<string, unknown> | null;
			}) {
				yield* translations.upsert({
					...input,
					populatedAt: yield* DateTime.nowAsDate,
				});
				return { entityId: input.entityId, language: input.language };
			},
		);

		const triggerInfrequentCron = () =>
			Effect.gen(function* () {
				const executionId = `infrequent-cron-manual-${generateId()}`;
				yield* engine
					.execute(InfrequentCronWorkflow, {
						executionId,
						discard: true,
						payload: { executionId },
					})
					.pipe(Effect.orDie);
				return { executionId };
			});

		const trackerExists = (trackerSlug: string) =>
			Effect.succeed({ exists: definitions.getTracker(trackerSlug) !== undefined });
		const linkSandboxScriptToEntitySchema = Effect.fn(function* (input: {
			entitySchemaSlug: EntitySchemaSlug;
			sandboxScriptId: SandboxScriptId;
		}) {
			const linked = yield* runInTransaction(entitySchemas.linkSandboxScript(input));
			return linked ?? (yield* badRequest("Entity schema not found"));
		});

		const countAutomationRules = Effect.fn("TestSupportService.countAutomationRules")(function* (
			userId: UserId,
		) {
			const count = yield* automations.countByUser(userId);
			return { count };
		});

		return {
			trackerExists,
			installDefinitions,
			linkAuthAccount,
			createGlobalEntity,
			deleteSandboxScript,
			countAutomationRules,
			setEntityPopulatedAt,
			triggerInfrequentCron,
			upsertEntityTranslation,
			upsertGlobalRelationship,
			listSignals: signals.list,
			setEntityInterest: interest.setInterest,
			getSandboxScript: sandbox.getStoredScript,
			deleteGlobalEntities: entities.deleteByIds,
			listSandboxScripts: sandbox.listStoredScripts,
			patchSandboxScript: sandbox.patchStoredScript,
			listEntityTranslations: translations.listByEntity,
			promoteSandboxScript: sandbox.promoteStoredScript,
			listGlobalRelationships: relationships.listGlobal,
			getBuiltinEntitySchema: (slug: string) =>
				Effect.succeed(definitions.getEntitySchema(slug)).pipe(
					Effect.flatMap((definition) =>
						definition
							? Effect.succeed({
									id: EntitySchemaSlug.make(definition.slug),
									slug: definition.slug,
									name: definition.name,
								})
							: Effect.fail(badRequest("Entity schema not found")),
					),
				),
			listSubscriptionRuns: automations.listRunsByExecutionUserId,
			linkSandboxScriptToEntitySchema,
		};
	}),
}) {}
