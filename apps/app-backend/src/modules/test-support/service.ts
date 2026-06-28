import { badRequest, notFound } from "@ryot/contract/errors";
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
import { SignalSchemasService } from "#modules/signals/service";

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
		const entities = yield* EntitiesService;
		const sandbox = yield* SandboxApiService;
		const automations = yield* AutomationsService;
		const translations = yield* TranslationsService;
		const signalSchemas = yield* SignalSchemasService;
		const relationships = yield* RelationshipsService;
		const entitySchemas = yield* EntitySchemasService;
		const runInTransaction = yield* TransactionRunner;
		const relationshipSchemas = yield* RelationshipSchemasService;

		const installBuiltinNotificationSubscription = Effect.fn(
			"TestSupportService.installBuiltinNotificationSubscription",
		)(function* (input: { userId: UserId; signalSchemaSlug: string }) {
			const signalSchema = yield* signalSchemas.getBuiltinBySlug(input.signalSchemaSlug);
			const scripts = yield* sandbox.listStoredScripts(null);
			const notificationScript = scripts.find(({ slug }) => slug === "automation.notification");
			if (!notificationScript) {
				return yield* notFound("Built-in notification script not found");
			}
			const rule = yield* automations.createUserRule({
				operation: "signal",
				userId: input.userId,
				kind: "subscription",
				name: signalSchema.name,
				sandboxScriptId: notificationScript.id,
				target: { id: signalSchema.id, kind: "signal_schema" },
			});
			return { id: rule.id };
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

		return {
			linkAuthAccount,
			createGlobalEntity,
			deleteSandboxScript,
			setEntityPopulatedAt,
			upsertEntityTranslation,
			upsertGlobalRelationship,
			installBuiltinNotificationSubscription,
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
