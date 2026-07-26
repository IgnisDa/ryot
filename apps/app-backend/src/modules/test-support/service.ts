import { badRequest } from "@ryot/contract/errors";
import type {
	TestSupportEnqueueSandboxBody,
	TestSupportStoredSandboxScript,
	TestSupportTriggerPluginCronBody,
} from "@ryot/contract/modules/test-support/schemas";
import {
	EntitySchemaSlug,
	type EntityId,
	type RelationshipSchemaSlug,
	SandboxProviderId,
	type SandboxScriptId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Context, DateTime, Effect, Layer } from "effect";

import { redisKeys, RedisService } from "#lib/infrastructure/redis";
import { AuthService } from "#modules/auth/service";
import { AutomationsService } from "#modules/automations/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { PluginBootService } from "#modules/scheduler/plugin-boot";
import { PluginCronService } from "#modules/scheduler/plugin-cron";
import { SignalsService } from "#modules/signals/service";

type CreateGlobalEntityInput = {
	readonly name: string;
	readonly externalId?: string | undefined;
	readonly entitySchemaSlug: EntitySchemaSlug;
	readonly properties: Record<string, unknown>;
	readonly populatedAt?: string | null | undefined;
	readonly providerId?: SandboxProviderId | undefined;
};

type StoredSandboxScriptRow = Omit<TestSupportStoredSandboxScript, "providerId"> & {
	readonly providerId: string | null;
};

const toStoredSandboxScript = (script: StoredSandboxScriptRow) => ({
	...script,
	providerId: script.providerId === null ? null : SandboxProviderId.make(script.providerId),
});

const parseDate = (value: string) => {
	const parsed = new Date(value);
	return !Number.isNaN(parsed.getTime())
		? Effect.succeed(parsed)
		: Effect.fail(badRequest("populatedAt must be a valid ISO 8601 date"));
};

export class TestSupportService extends Context.Service<TestSupportService>()(
	"TestSupportService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			const redis = yield* RedisService;
			const signals = yield* SignalsService;
			const entities = yield* EntitiesService;
			const interest = yield* InterestService;
			const pluginCrons = yield* PluginCronService;
			const pluginBoots = yield* PluginBootService;
			const definitions = yield* DefinitionRegistry;
			const automations = yield* AutomationsService;
			const sandbox = yield* SandboxExecutionService;
			const translations = yield* TranslationsService;
			const relationships = yield* RelationshipsService;
			const relationshipSchemas = yield* RelationshipSchemasRepository;

			const createGlobalEntity = Effect.fn("TestSupportService.createGlobalEntity")(function* (
				input: CreateGlobalEntityInput,
			) {
				const created = yield* entities.createGlobal({
					name: input.name,
					populatedAt: null,
					properties: input.properties,
					externalId: input.externalId,
					providerId: input.providerId,
					entitySchemaSlug: input.entitySchemaSlug,
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

			const triggerPluginCron = (input: TestSupportTriggerPluginCronBody) =>
				pluginCrons.trigger(input.pluginSlug, input.cronSlug, `plugin-cron-manual-${generateId()}`);

			const triggerPluginBoot = Effect.gen(function* () {
				const executionId = `plugin-boot-manual-${generateId()}`;
				yield* pluginBoots.triggerAll(executionId);
				return { executionId };
			});

			const countAutomationRules = Effect.fn("TestSupportService.countAutomationRules")(function* (
				userId: UserId,
			) {
				const count = yield* automations.countByUser(userId);
				return { count };
			});

			const getSandboxScript = Effect.fn("TestSupportService.getSandboxScript")(function* (
				scriptId: SandboxScriptId,
			) {
				const script = yield* sandbox.getStoredScript(scriptId);
				return toStoredSandboxScript(script as StoredSandboxScriptRow);
			});

			const listSandboxScripts = Effect.fn("TestSupportService.listSandboxScripts")(function* () {
				const scripts = yield* sandbox.listStoredScripts;
				return scripts.map((script) => toStoredSandboxScript(script as StoredSandboxScriptRow));
			});

			return {
				linkAuthAccount,
				getSandboxScript,
				triggerPluginBoot,
				triggerPluginCron,
				listSandboxScripts,
				createGlobalEntity,
				countAutomationRules,
				setEntityPopulatedAt,
				upsertEntityTranslation,
				upsertGlobalRelationship,
				listSignals: signals.list,
				getSandboxResult: sandbox.getResult,
				setEntityInterest: interest.setInterest,
				deleteGlobalEntities: entities.deleteByIds,
				listEntityTranslations: translations.listByEntity,
				listGlobalRelationships: relationships.listGlobal,
				listSubscriptionRuns: automations.listRunsByExecutionUserId,
				deleteSandboxReplayProjection: (executionId: string) =>
					redis
						.del(redisKeys.sandboxWorkflowJournal(executionId))
						.pipe(Effect.map((deleted) => ({ deleted: deleted > 0 }))),
				enqueueSandbox: (input: TestSupportEnqueueSandboxBody) => {
					const { durable, executingUserId, ...payload } = input;
					return durable
						? sandbox.enqueueDurable(executingUserId, payload)
						: sandbox.enqueue(executingUserId, payload);
				},
				getBuiltinEntitySchema: (slug: string) =>
					Effect.succeed(definitions.getEntitySchema(slug)).pipe(
						Effect.flatMap((definition) =>
							definition
								? Effect.succeed({
										slug: definition.slug,
										name: definition.name,
										id: EntitySchemaSlug.make(definition.slug),
									})
								: Effect.fail(badRequest("Entity schema not found")),
						),
					),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
