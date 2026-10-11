import { badRequest, DbError, notFound } from "@ryot-app/contract/errors";
import { AutomationSignalPayload } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	definitionKey,
	type SignalSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipSchemaSlug,
	type EntityId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import { lifecycleTrigger } from "#modules/automations/lifecycle/command";
import { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import { LifecyclePlanner, toLifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import { DefinitionRepository } from "#modules/definitions/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { PluginRepository } from "#modules/plugins/packages/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { DatabaseSession } from "#platform/db/session";

import { AutomationTriggerRepository } from "./trigger-repository";

export type EmitSignalInput = {
	command: DomainLifecycleCommand;
	reference: SignalSchemaReference;
	properties: unknown;
	principal: { kind: "user"; userId: UserId } | { kind: "system" };
	subjectEntityId?: EntityId;
};

export class SignalEmissionService extends Context.Service<SignalEmissionService>()(
	"SignalEmissionService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const assetReferences = yield* ManagedAssetReferenceLocker.make;
			const planner = yield* LifecyclePlanner;
			const execution = yield* LifecycleExecution;
			const triggers = yield* AutomationTriggerRepository;
			const plugins = yield* PluginRepository;
			const entities = yield* EntitiesRepository;
			const relationships = yield* RelationshipsRepository;
			const definitions = yield* DefinitionRepository;

			const emitSignal = Effect.fn("SignalEmissionService.emitSignal")(function* (
				input: EmitSignalInput,
			) {
				const command = yield* Schema.decodeEffect(DomainLifecycleCommand)(input.command).pipe(
					Effect.mapError(() => badRequest("Invalid signal lifecycle command")),
				);
				const actorUserId = input.principal.kind === "user" ? input.principal.userId : null;
				const pinnedPlugin = command.writeContext?.pluginRevision;
				if (
					pinnedPlugin &&
					(input.reference.owner.kind !== "plugin" ||
						input.reference.owner.pluginId !== pinnedPlugin.id)
				) {
					return yield* badRequest("Signal owner does not match the pinned execution authority");
				}
				const definitionContext = pinnedPlugin
					? { pluginId: pinnedPlugin.id, pluginRevisionId: pinnedPlugin.revisionId }
					: undefined;
				const plan = yield* session.transaction(
					Effect.gen(function* () {
						yield* plugins.lockIngestionShared();
						const snapshot = definitionContext
							? yield* definitions.getSnapshotForContext(definitionContext, actorUserId)
							: null;
						const schema = snapshot
							? snapshot.signalSchemas[
									definitionKey("signal", input.reference.owner, input.reference.slug)
								]
							: yield* actorUserId === null
									? definitions.findGlobalSignalSchema(input.reference)
									: definitions.findUserSignalSchema(actorUserId, input.reference);
						if (!schema) {
							return yield* notFound("Signal schema not found");
						}
						const properties = yield* parseAppSchemaProperties({
							kind: "Signal",
							properties: input.properties,
							propertiesSchema: schema.propertiesSchema,
						}).pipe(Effect.mapError((error) => badRequest(error.message)));
						yield* assetReferences.lock([
							{ properties, ownerUserId: actorUserId, propertiesSchema: schema.propertiesSchema },
						]);
						const normalized = yield* Schema.decodeUnknownEffect(AutomationSignalPayload)({
							properties,
							actorUserId,
							operation: "emit",
							category: "signal",
							resource: "signal",
							signalSchemaPluginId: schema.pluginId,
							signalSchemaSlug: input.reference.slug,
							...(input.subjectEntityId === undefined
								? {}
								: { subjectEntityId: input.subjectEntityId }),
						}).pipe(Effect.mapError(() => badRequest("Invalid signal properties")));
						const trigger = lifecycleTrigger(command, actorUserId, normalized);
						if (yield* triggers.findById(trigger.id)) {
							return yield* planner.plan({ trigger });
						}
						if (schema.audiencePolicy.kind === "actor" && actorUserId === null) {
							return yield* badRequest("Actor audience requires a user principal");
						}
						if (input.subjectEntityId) {
							const subject = yield* actorUserId === null
								? entities.findGlobalEntityById(input.subjectEntityId)
								: entities.getEntityScopeForUser({
										userId: actorUserId,
										entityId: input.subjectEntityId,
									});
							if (!subject) {
								return yield* notFound("Entity not found");
							}
							if (pinnedPlugin && subject.entitySchemaPluginId !== pinnedPlugin.id) {
								return yield* badRequest(
									"Signal subject does not belong to the pinned plugin owner",
								);
							}
						}
						let recipients: ReadonlyArray<UserId> = [];
						const policy = schema.audiencePolicy;
						if (policy.kind === "related_users") {
							if (!input.subjectEntityId) {
								return yield* badRequest("Related-users audience requires a subject entity");
							}
							const relationshipSchemaKey = definitionKey(
								"relationship",
								input.reference.owner,
								policy.relationshipSchemaSlug,
							);
							let relationshipSchema;
							if (snapshot) {
								relationshipSchema = snapshot.relationshipSchemas[relationshipSchemaKey];
							} else if (actorUserId === null) {
								const schemas = yield* definitions.findGlobalRelationshipSchemas([
									{ owner: input.reference.owner, slug: policy.relationshipSchemaSlug },
								]);
								relationshipSchema = schemas[relationshipSchemaKey];
							} else {
								const schemas = yield* definitions.findUserRelationshipSchemas(actorUserId, [
									{ owner: input.reference.owner, slug: policy.relationshipSchemaSlug },
								]);
								relationshipSchema = schemas[relationshipSchemaKey];
							}
							if (!relationshipSchema) {
								return yield* badRequest("Signal audience relationship schema not found");
							}
							recipients = yield* relationships.listEnabledOwnersForSubject({
								subjectSide: policy.subjectSide,
								subjectEntityId: input.subjectEntityId,
								relationshipSchemaPluginId: relationshipSchema.pluginId,
								relationshipSchemaSlug: RelationshipSchemaSlug.make(policy.relationshipSchemaSlug),
							});
						}
						return yield* planner.plan({ trigger, recipients });
					}),
				);
				if (plan.trigger === null) {
					return yield* new DbError({ message: "Signal planning did not retain its trigger" });
				}
				const warnings = yield* execution
					.dispatch([toLifecycleDispatchPlan(plan)])
					.pipe(Effect.catchTag("LifecyclePersistenceError", Effect.die));
				return { warnings, triggerId: plan.trigger.id, wasCreated: plan.wasCreated };
			});
			return { emitSignal };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
