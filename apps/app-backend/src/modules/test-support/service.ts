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
import { kernelDefinitionSource } from "#modules/definition-registry/kernel-source";
import {
	DefinitionRegistry,
	definitionSourceFromSnapshot,
} from "#modules/definition-registry/service";
import { EntitiesService } from "#modules/entities/service";
import { InterestService } from "#modules/entity-interest/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { PluginLoader } from "#modules/plugins/loader";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxApiService } from "#modules/sandbox/service";
import { InfrequentCronWorkflow } from "#modules/scheduler/cron-workflow";
import { SignalsService } from "#modules/signals/service";

type CreateGlobalEntityInput = {
	readonly name: string;
	readonly externalId?: string | undefined;
	readonly entitySchemaSlug: EntitySchemaSlug;
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
	builtinSlugs: ReadonlySet<string>,
) => {
	const merged = new Map(current.map((definition) => [definition.slug, definition]));
	for (const definition of additions ?? []) {
		if (builtinSlugs.has(definition.slug)) {
			throw new Error(`Builtin definition slug cannot be replaced: ${definition.slug}`);
		}
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
		const interest = yield* InterestService;
		const sandbox = yield* SandboxApiService;
		const pluginLoader = yield* PluginLoader;
		const definitions = yield* DefinitionRegistry;
		const automations = yield* AutomationsService;
		const translations = yield* TranslationsService;
		const relationships = yield* RelationshipsService;
		const pluginRuntime = yield* PluginRuntimeResolver;
		const runInTransaction = yield* TransactionRunner;
		const relationshipSchemas = yield* RelationshipSchemasRepository;
		const installDefinitions = Effect.fn("TestSupportService.installDefinitions")(function* (
			input: TestSupportInstallDefinitions,
		) {
			const current = definitionSourceFromSnapshot(definitions.getSnapshot());
			const kernel = kernelDefinitionSource();
			const plugins = Object.values(pluginLoader.getSnapshot().plugins);
			const builtinEntitySchemaSlugs = new Set([
				...kernel.entitySchemas.map(({ slug }) => slug),
				...plugins.flatMap(({ manifest }) => manifest.entitySchemas.map(({ slug }) => slug)),
			]);
			const builtinRelationshipSchemaSlugs = new Set([
				...kernel.relationshipSchemas.map(({ slug }) => slug),
				...plugins.flatMap(({ manifest }) => manifest.relationshipSchemas.map(({ slug }) => slug)),
			]);
			const nonBuiltinEntitySchemaSlugs = new Set(
				current.entitySchemas
					.filter(({ slug }) => !definitions.isEntitySchemaBuiltin(slug))
					.map(({ slug }) => slug),
			);
			const nonBuiltinRelationshipSchemaSlugs = new Set(
				current.relationshipSchemas
					.filter(({ slug }) => !definitions.isRelationshipSchemaBuiltin(slug))
					.map(({ slug }) => slug),
			);
			for (const definition of input.entitySchemas ?? []) {
				nonBuiltinEntitySchemaSlugs.add(definition.slug);
			}
			for (const definition of input.relationshipSchemas ?? []) {
				nonBuiltinRelationshipSchemaSlugs.add(definition.slug);
			}
			yield* Effect.try({
				try: () =>
					definitions.replace(
						{
							...current,
							entitySchemas: mergeBySlug(
								current.entitySchemas,
								input.entitySchemas?.map((definition) => ({
									...definition,
									pluginSlug: definition.pluginSlug ?? null,
								})),
								builtinEntitySchemaSlugs,
							),
							relationshipSchemas: mergeBySlug(
								current.relationshipSchemas,
								input.relationshipSchemas,
								builtinRelationshipSchemaSlugs,
							),
						},
						{
							nonBuiltinEntitySchemaSlugs,
							nonBuiltinRelationshipSchemaSlugs,
						},
					),
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
					yield* pluginRuntime.unregisterTestSchemaScript(scriptId);
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

		const linkSandboxScriptToEntitySchema = Effect.fn(function* (input: {
			entitySchemaSlug: EntitySchemaSlug;
			sandboxScriptId: SandboxScriptId;
		}) {
			const linked = yield* runInTransaction(pluginRuntime.registerTestSchemaScript(input));
			return linked ?? (yield* badRequest("Entity schema not found"));
		});

		const countAutomationRules = Effect.fn("TestSupportService.countAutomationRules")(function* (
			userId: UserId,
		) {
			const count = yield* automations.countByUser(userId);
			return { count };
		});

		return {
			linkAuthAccount,
			installDefinitions,
			createGlobalEntity,
			deleteSandboxScript,
			countAutomationRules,
			setEntityPopulatedAt,
			triggerInfrequentCron,
			upsertEntityTranslation,
			upsertGlobalRelationship,
			listSignals: signals.list,
			linkSandboxScriptToEntitySchema,
			setEntityInterest: interest.setInterest,
			getSandboxScript: sandbox.getStoredScript,
			deleteGlobalEntities: entities.deleteByIds,
			listSandboxScripts: sandbox.listStoredScripts,
			patchSandboxScript: sandbox.patchStoredScript,
			listEntityTranslations: translations.listByEntity,
			promoteSandboxScript: sandbox.promoteStoredScript,
			listGlobalRelationships: relationships.listGlobal,
			listSubscriptionRuns: automations.listRunsByExecutionUserId,
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
		};
	}),
}) {}
