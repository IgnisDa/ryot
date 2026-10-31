import type { EnrichmentState } from "@ryot-app/contract/modules/entities/schemas";
import { EntityId } from "@ryot-app/contract/schema/brands";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	selectedAggregate,
	selectedField,
	selectedMeasure,
	selectedOptionalRow,
	table,
} from "@ryot-app/ryotql";
import { Effect, Result, Schema } from "effect";

import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { getEntity } from "./entities";
import { pollUntil } from "./polling";
import { executeAdminRyotQLRecipe } from "./ryotql";

const translation = table("entityTranslation", "translation");

const entityTranslationRecipe = defineRecipe((input: { entityId: string; language: string }) => ({
	map: ({ row }) => Result.succeed(row ?? null),
	queries: {
		row: selectedOptionalRow(translation, {
			orderBy: [ascending(column(translation, "language"))],
			where: and(
				eq(column(translation, "entityId"), literal(input.entityId)),
				eq(column(translation, "language"), literal(input.language)),
			),
			selection: {
				entityId: selectedField(column(translation, "entityId"), Schema.String),
				language: selectedField(column(translation, "language"), Schema.String),
				populatedAt: selectedField(column(translation, "populatedAt"), Schema.String),
				name: selectedField(column(translation, "name"), Schema.NullOr(Schema.String)),
				properties: selectedField(
					column(translation, "properties"),
					Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
				),
			},
		}),
	},
}));

const entityTranslationCountRecipe = defineRecipe((entityId: string) => ({
	map: ({ rows }) => Result.succeed(rows.count),
	queries: {
		rows: selectedAggregate(translation, {
			where: eq(column(translation, "entityId"), literal(entityId)),
			measures: { count: selectedMeasure({ function: "count" }, Schema.Int) },
		}),
	},
}));

export const seedEntityTranslation = (input: {
	entityId: string;
	language: string;
	name?: null | string;
	properties?: null | Record<string, unknown>;
}) =>
	getApiClient().adminCall((c) =>
		c.testSupport.upsertEntityTranslation({
			payload: {
				language: input.language,
				name: input.name ?? null,
				properties: input.properties ?? null,
				entityId: EntityId.make(input.entityId),
			},
		}),
	);

export const getEntityTranslationRow = (input: { entityId: string; language: string }) =>
	executeAdminRyotQLRecipe(entityTranslationRecipe(input));

export const countEntityTranslations = (entityId: string) =>
	executeAdminRyotQLRecipe(entityTranslationCountRecipe(entityId));

export const pollEntityUntilTranslationAvailability = (
	client: Client,
	entityId: string,
	target: EnrichmentState["availability"],
) =>
	pollUntil(
		`entity '${entityId}' translation availability=${target}`,
		Effect.gen(function* () {
			const entity = yield* getEntity(client, entityId);
			return entity.translationStatus.availability === target ? entity : null;
		}),
	);
