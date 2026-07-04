import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { badRequest } from "@ryot/contract/errors";
import type {
	EntityId,
	EntitySchemaId,
	RelationshipSchemaId,
	SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import { dayjs } from "@ryot/ts-utils/dayjs";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";

import { TransactionRunner } from "#lib/infrastructure/db/service";
import { AuthService } from "#modules/auth/service";
import { AutomationsService } from "#modules/automations/service";
import { EntitiesService } from "#modules/entities/service";
import { EntitySchemasService } from "#modules/entity-schemas/service";
import { TranslationsService } from "#modules/entity-translation/service";
import { RelationshipSchemasService } from "#modules/relationship-schemas/service";
import { RelationshipsService } from "#modules/relationships/service";
import { SandboxApiService } from "#modules/sandbox/service";
import { InfrequentCronWorkflow } from "#modules/scheduler/cron-workflow";
import { SignalsService } from "#modules/signals/service";

type CreateGlobalEntityInput = {
	readonly name: string;
	readonly entitySchemaId: EntitySchemaId;
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

export class TestSupportService extends Effect.Service<TestSupportService>()("TestSupportService", {
	effect: Effect.gen(function* () {
		const auth = yield* AuthService;
		const engine = yield* WorkflowEngine;
		const signals = yield* SignalsService;
		const automations = yield* AutomationsService;
		const entities = yield* EntitiesService;
		const sandbox = yield* SandboxApiService;
		const translations = yield* TranslationsService;
		const relationships = yield* RelationshipsService;
		const entitySchemas = yield* EntitySchemasService;
		const runInTransaction = yield* TransactionRunner;
		const relationshipSchemas = yield* RelationshipSchemasService;

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
				entitySchemaId: input.entitySchemaId,
				sandboxScriptId: input.sandboxScriptId,
			});
			if (input.populatedAt === undefined) {
				return created;
			}
			return yield* entities.update({
				name: created.name,
				entityId: created.id,
				properties: created.properties,
				entitySchemaId: created.entitySchemaId,
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
				entitySchemaId: entity.entitySchemaId,
				populatedAt: populatedAt === null ? null : yield* parseDate(populatedAt),
			});
		});

		const upsertGlobalRelationship = Effect.fn("TestSupportService.upsertGlobalRelationship")(
			function* (input: {
				sourceEntityId: EntityId;
				targetEntityId: EntityId;
				relationshipSchemaId: RelationshipSchemaId;
				properties?: Record<string, unknown> | undefined;
			}) {
				const relationshipSchema = yield* relationshipSchemas.findById(
					input.relationshipSchemaId,
					null,
				);
				return yield* relationships.create({
					scope: "global",
					properties: input.properties ?? {},
					sourceEntityId: input.sourceEntityId,
					targetEntityId: input.targetEntityId,
					relationshipSchemaId: input.relationshipSchemaId,
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

		return {
			linkAuthAccount,
			createGlobalEntity,
			deleteSandboxScript,
			setEntityPopulatedAt,
			triggerInfrequentCron,
			upsertEntityTranslation,
			upsertGlobalRelationship,
			listSignals: signals.list,
			listSubscriptionRuns: automations.listRunsByExecutionUserId,
			getSandboxScript: sandbox.getStoredScript,
			deleteGlobalEntities: entities.deleteByIds,
			listSandboxScripts: sandbox.listStoredScripts,
			patchSandboxScript: sandbox.patchStoredScript,
			listEntityTranslations: translations.listByEntity,
			promoteSandboxScript: sandbox.promoteStoredScript,
			listGlobalRelationships: relationships.listGlobal,
			getBuiltinEntitySchema: entitySchemas.getBuiltinBySlug,
			linkSandboxScriptToEntitySchema: entitySchemas.linkSandboxScript,
		};
	}),
}) {}
