import { type DbError, mapDbErrorToSandbox, SandboxRunError } from "@ryot-app/contract/errors";
import type { AutomationPopulationContext } from "@ryot-app/contract/modules/automations/lifecycle";
import type { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { definitionKey, definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import {
	type EntityId,
	EntitySchemaSlug,
	type PluginId,
	RelationshipSchemaSlug,
	type SandboxProviderId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import type { EntityRelationshipDefinitions } from "@ryot-app/definitions/snapshot";
import type { ProviderDetailsChildEntity } from "@ryot-app/plugin-backend-sdk/provider";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Ref } from "effect";

import { populationLifecycleCommand } from "#modules/automations/lifecycle/command";
import type { Changes } from "#modules/changes/changes";
import type { CommitResult } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { EntitiesRepository } from "#modules/entities/repository";
import type { DomainLifecycleCommand } from "#modules/entities/write-context";
import { retryOnDeadlock } from "#platform/db/errors";
import type { DatabaseSessionStateError } from "#platform/db/session";

/** The population request attempt whose writes a commit must still own. */
export type PopulationOwner = { readonly requestId: string; readonly requestAttempt: number };

/** The population command of one write, which every change and trigger it records carries. */
export const populationCommand = (
	command: DomainLifecycleCommand,
	itemIdentity: ReadonlyArray<string>,
	population: AutomationPopulationContext,
): DomainLifecycleCommand => ({
	...populationLifecycleCommand(command, itemIdentity, population),
	writeContext: command.writeContext,
});

/**
 * Commits population changes while the request attempt still owns its writes and, for related
 * writes, `generation` is still the entity's related population. A released request fails; a
 * superseded generation writes nothing and returns null.
 */
export const commitPopulation = Effect.fn("commitPopulation")(function* (input: {
	readonly changes: Changes;
	readonly owner: PopulationOwner;
	readonly command: DomainLifecycleCommand;
	readonly written?: Effect.Effect<void, DbError | DatabaseSessionStateError>;
	readonly generation?: { readonly entityId: EntityId; readonly generation: string };
}) {
	const changeSets = yield* ChangeSets;
	const requests = yield* EnrichmentRequests;
	const repository = yield* EntitiesRepository;
	const refused = yield* Ref.make<null | "released" | "superseded">(null);
	const { owner, generation } = input;
	const check = Effect.gen(function* () {
		if (!(yield* requests.ownsPopulation(owner.requestId, owner.requestAttempt))) {
			return yield* Ref.set(refused, "released").pipe(Effect.as(false));
		}
		if (
			generation &&
			!(yield* repository.holdsRelatedPopulationGeneration(
				generation.entityId,
				generation.generation,
			))
		) {
			return yield* Ref.set(refused, "superseded").pipe(Effect.as(false));
		}
		return yield* Ref.set(refused, null).pipe(Effect.as(true));
	}).pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
	const result = yield* retryOnDeadlock(
		changeSets.commit(input.changes, input.command, {
			queueFolds: true,
			entities: { verbatimIdentities: true },
			precondition: {
				check,
				written: () =>
					(input.written ?? Effect.void).pipe(
						Effect.catchTag("DatabaseSessionStateError", Effect.die),
					),
			},
		}),
	).pipe(mapDbErrorToSandbox);
	const reason = yield* Ref.get(refused);
	if (reason === "released") {
		return yield* new SandboxRunError({
			kind: "invalid-input",
			message: "Provider population no longer owns its writes",
		});
	}
	return reason === "superseded" ? null : result;
});

/** The entity a population commit upserted under `itemIdentity`. */
export const upsertedEntity = (result: CommitResult, itemIdentity: string) => {
	const upserted = result.entities.find((entry) => entry.itemIdentity === itemIdentity);
	return upserted
		? Effect.succeed(upserted.entity)
		: Effect.die("A population upsert is missing its result");
};

/**
 * Writes a parent's child entities and reconciles its authoritative child relationships in one
 * commit, keeping the properties of child relationships that exist. Children follow input order.
 */
export const writeChildEntitySet = Effect.fn("writeChildEntitySet")(function* (input: {
	pluginId: PluginId;
	userId: null | UserId;
	owner: PopulationOwner;
	syncExisting?: boolean;
	parentEntityId: EntityId;
	providerId: SandboxProviderId;
	command: DomainLifecycleCommand;
	population: AutomationPopulationContext;
	parentEntitySchemaSlug: EntitySchemaSlug;
	definitions: EntityRelationshipDefinitions;
	expectedChildEntitySchemaSlug?: string | undefined;
	childEntities: ReadonlyArray<ProviderDetailsChildEntity>;
}) {
	const childSchemaSlugs = new Set(
		input.childEntities.map(({ entitySchemaSlug }) => entitySchemaSlug),
	);
	if (childSchemaSlugs.size > 1) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: "Child entities must use one entity schema",
		});
	}
	const rowChildEntitySchemaSlug = input.childEntities[0]?.entitySchemaSlug;
	if (
		rowChildEntitySchemaSlug &&
		input.expectedChildEntitySchemaSlug &&
		input.expectedChildEntitySchemaSlug !== rowChildEntitySchemaSlug
	) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: `Child entity schema does not match declared schema: ${rowChildEntitySchemaSlug} !== ${input.expectedChildEntitySchemaSlug}`,
		});
	}
	const childEntitySchemaSlug = input.expectedChildEntitySchemaSlug ?? rowChildEntitySchemaSlug;
	if (!childEntitySchemaSlug) {
		return [];
	}
	const owner = definitionOwner(input.pluginId);
	if (!input.definitions.entitySchemas[definitionKey("entity", owner, childEntitySchemaSlug)]) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: `Child entity schema not found: ${childEntitySchemaSlug}`,
		});
	}
	const relationshipDefinition = Object.values(input.definitions.relationshipSchemas).find(
		(definition) =>
			definition.pluginId === input.pluginId &&
			definition.sourceEntitySchemaSlug === input.parentEntitySchemaSlug &&
			definition.targetEntitySchemaSlug === childEntitySchemaSlug,
	);
	if (!relationshipDefinition) {
		return yield* new SandboxRunError({
			kind: "script-failure",
			message: `Child relationship schema not found: ${input.parentEntitySchemaSlug} -> ${childEntitySchemaSlug}`,
		});
	}
	const entitySchema = { owner, slug: EntitySchemaSlug.make(childEntitySchemaSlug) };
	const parent = { kind: "existing" as const, entityId: input.parentEntityId };
	const childIdentity = (child: ProviderDetailsChildEntity) =>
		stableStringify([
			input.command.itemIdentity,
			"child",
			String(input.parentEntityId),
			child.externalId,
		]);
	const children = new Map(input.childEntities.map((child) => [child.externalId, child]));
	const result = yield* commitPopulation({
		owner: input.owner,
		command: populationCommand(
			input.command,
			["children", String(input.parentEntityId), relationshipDefinition.slug],
			input.population,
		),
		changes: {
			userId: input.userId,
			globalEntities: input.childEntities.map((child) => ({
				entitySchema,
				name: child.name,
				externalId: child.externalId,
				properties: child.properties,
				itemIdentity: childIdentity(child),
				populatedAt: input.command.occurredAt,
				provider: { providerId: input.providerId, updateExisting: input.syncExisting ?? false },
			})),
			globalRelationships: [
				{
					preserveExisting: true,
					selector: { anchor: parent, type: "anchored", direction: "outgoing" },
					relationshipSchema: {
						slug: RelationshipSchemaSlug.make(relationshipDefinition.slug),
						owner: definitionOwner(relationshipDefinition.pluginId ?? null),
					},
					relationships: [...children.values()].map((child) => ({
						properties: {},
						source: parent,
						target: {
							entitySchema,
							kind: "upserted",
							externalId: child.externalId,
							providerId: input.providerId,
						},
					})),
				},
			],
		},
	});
	if (result === null) {
		return yield* Effect.die("A child entity set has no related generation to lose");
	}
	return yield* Effect.forEach(input.childEntities, (child): Effect.Effect<ListedEntity> =>
		upsertedEntity(result, childIdentity(child)),
	);
});
