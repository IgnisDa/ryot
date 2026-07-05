import {
	AutomationOccurrencePopulation,
	AutomationOccurrenceSource,
	AutomationOperation,
	AutomationOrigin,
	AutomationRuleMetadata,
} from "@ryot-app/contract/modules/automations/schemas";
import { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import type { Recipe } from "@ryot-app/ryotql";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	inArray,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

import { IsoDateString } from "./codecs";
import { eventHistoryRecipe } from "./events";

export const entityReadRecipe = defineRecipe(
	(input: { readonly entityIds: readonly [string, ...string[]] }) => {
		const entity = table("entity", "entity");
		return {
			map: ({ entities }) => Result.succeed(entities),
			queries: {
				entities: selectedRows(entity, {
					limit: 100,
					orderBy: [ascending(column(entity, "id"))],
					where: inArray(
						column(entity, "id"),
						input.entityIds.map((entityId) => literal(entityId)),
					),
					selection: {
						id: selectedField(column(entity, "id"), EntityId),
						name: selectedField(column(entity, "name"), Schema.String),
						properties: selectedField(column(entity, "properties"), JsonValue),
						createdAt: selectedField(column(entity, "createdAt"), IsoDateString),
						updatedAt: selectedField(column(entity, "updatedAt"), IsoDateString),
						entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), EntitySchemaSlug),
						externalId: selectedField(column(entity, "externalId"), Schema.NullOr(Schema.String)),
						populatedAt: selectedField(column(entity, "populatedAt"), Schema.NullOr(IsoDateString)),
						providerId: selectedField(
							column(entity, "providerId"),
							Schema.NullOr(SandboxProviderId),
						),
					},
				}),
			},
		};
	},
);

export const eventReadRecipe = (input: {
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly after?: string | undefined;
	readonly entityId?: string | undefined;
	readonly sessionEntityId?: string | undefined;
}) =>
	eventHistoryRecipe({
		after: input.after,
		entityId: input.entityId,
		sessionEntityId: input.sessionEntityId,
		eventSchemaSlugs: [input.eventSchemaSlug],
		entitySchemaSlugs: [input.entitySchemaSlug],
	});

export const automationOccurrenceRecipe = defineRecipe((occurrenceId: string) => {
	const occurrence = table("automationOccurrence", "occurrence");
	return {
		map: ({ occurrences }) => Result.succeed(occurrences.items[0] ?? null),
		queries: {
			occurrences: selectedRows(occurrence, {
				limit: 1,
				where: eq(column(occurrence, "id"), literal(occurrenceId)),
				selection: {
					origin: selectedField(column(occurrence, "origin"), AutomationOrigin),
					operation: selectedField(column(occurrence, "operation"), AutomationOperation),
					source: selectedField(column(occurrence, "source"), AutomationOccurrenceSource),
					population: selectedField(
						column(occurrence, "population"),
						Schema.NullOr(AutomationOccurrencePopulation),
					),
				},
			}),
		},
	};
});

export const automationRunRecipe = defineRecipe((runId: string) => {
	const run = table("subscriptionRun", "run");
	return {
		map: ({ runs }) => Result.succeed(runs.items[0] ?? null),
		queries: {
			runs: selectedRows(run, {
				limit: 1,
				where: eq(column(run, "id"), literal(runId)),
				selection: {
					ruleMetadata: selectedField(
						column(run, "ruleMetadata"),
						Schema.NullOr(AutomationRuleMetadata),
					),
				},
			}),
		},
	};
});

export type EntityReadResult = Recipe.Success<typeof entityReadRecipe>;
export type EventReadResult = Recipe.Success<typeof eventReadRecipe>;
