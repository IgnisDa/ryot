import { badRequest, notFound } from "@ryot-app/contract/errors";
import {
	AutomationSignalPayload,
	type AutomationWarning,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { LifecyclePlanner } from "#lib/domain/lifecycle";
import { LifecycleCommand, lifecycleTrigger } from "#lib/domain/lifecycle-command";
import { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { EntitiesRepository } from "#modules/entities/repository";
import { PluginRepository } from "#modules/plugins/repository";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SignalSchemasRepository } from "#modules/signals/signal-schemas-repository";

import { AutomationTriggerRepository } from "./trigger-repository";

export type EmitSignalInput = {
	command: LifecycleCommand;
	schemaSlug: string;
	properties: unknown;
	principal: { kind: "user"; userId: UserId } | { kind: "system" };
	subjectEntityId?: EntityId;
};

export class SignalEmissionService extends Context.Service<SignalEmissionService>()(
	"SignalEmissionService",
	{
		make: Effect.gen(function* () {
			const planner = yield* LifecyclePlanner;
			const execution = yield* LifecycleExecution;
			const triggers = yield* AutomationTriggerRepository;
			const plugins = yield* PluginRepository;
			const schemas = yield* SignalSchemasRepository;
			const entities = yield* EntitiesRepository;
			const relationships = yield* RelationshipsRepository;
			const relationshipSchemas = yield* RelationshipSchemasRepository;
			const runtime = yield* PluginRuntimeResolver;

			const emitSignal = Effect.fn("SignalEmissionService.emitSignal")(function* (
				input: EmitSignalInput,
			) {
				const database = yield* Database;
				const command = yield* Schema.decodeEffect(LifecycleCommand)(input.command).pipe(
					Effect.mapError(() => badRequest("Invalid signal lifecycle command")),
				);
				const actorUserId = input.principal.kind === "user" ? input.principal.userId : null;
				const plan = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							yield* plugins.lockIngestionShared();
							const schema = yield* schemas.findVisibleBySlug({
								userId: actorUserId,
								slug: input.schemaSlug,
							});
							if (!schema) {
								return yield* notFound("Signal schema not found");
							}
							const properties = yield* parseAppSchemaProperties({
								kind: "Signal",
								properties: input.properties,
								propertiesSchema: schema.propertiesSchema,
							}).pipe(Effect.mapError((error) => badRequest(error.message)));
							const normalized = yield* Schema.decodeUnknownEffect(AutomationSignalPayload)({
								properties,
								actorUserId,
								operation: "emit",
								category: "signal",
								resource: "signal",
								signalSchemaSlug: input.schemaSlug,
								signalSchemaPluginId: schema.pluginId ?? null,
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
							}
							let recipients: ReadonlyArray<UserId> = [];
							const policy = schema.audiencePolicy;
							if (policy.kind === "related_users") {
								if (!input.subjectEntityId) {
									return yield* badRequest("Related-users audience requires a subject entity");
								}
								const relationshipSchema =
									actorUserId === null
										? yield* relationshipSchemas.findById(policy.relationshipSchemaSlug, null)
										: (yield* runtime.getEffectiveDefinitions(actorUserId)).relationshipSchemas[
												policy.relationshipSchemaSlug
											];
								if (!relationshipSchema) {
									return yield* badRequest("Signal audience relationship schema not found");
								}
								recipients = yield* relationships.listEnabledOwnersForSubject({
									subjectSide: policy.subjectSide,
									subjectEntityId: input.subjectEntityId,
									relationshipSchemaSlug: policy.relationshipSchemaSlug,
									relationshipSchemaPluginId: relationshipSchema.pluginId ?? null,
								});
							}
							return yield* planner.plan({ trigger, recipients });
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);
				const warnings: AutomationWarning[] = [];
				if (plan.trigger.blockedReason?.hasRequiredHooks) {
					warnings.push({ ...plan.trigger.blockedReason, triggerId: plan.trigger.id });
				}
				warnings.push(...(yield* execution.after({ runs: plan.runs, triggerId: plan.trigger.id })));
				return { warnings, triggerId: plan.trigger.id, wasCreated: plan.wasCreated };
			});
			return { emitSignal };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
