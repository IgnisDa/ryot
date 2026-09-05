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

import { adminHeaders } from "./admin";
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
			orderBy: [ascending(column(translation, "id"))],
			where: and(
				eq(column(translation, "entityId"), literal(input.entityId)),
				eq(column(translation, "language"), literal(input.language)),
			),
			selection: {
				id: selectedField(column(translation, "id"), Schema.String),
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
	name?: string | null;
	properties?: Record<string, unknown> | null;
}) =>
	getApiClient().call(
		(c) =>
			c.testSupport.upsertEntityTranslation({
				payload: {
					language: input.language,
					name: input.name ?? null,
					properties: input.properties ?? null,
					entityId: EntityId.make(input.entityId),
				},
			}),
		adminHeaders(),
	);

export const getEntityTranslationRow = (input: { entityId: string; language: string }) =>
	executeAdminRyotQLRecipe(entityTranslationRecipe(input));

export const countEntityTranslations = (entityId: string) =>
	executeAdminRyotQLRecipe(entityTranslationCountRecipe(entityId));

/** Re-reads the entity until its translationStatus settles to `target`. */
export const pollEntityUntilTranslationStatus = (
	client: Client,
	entityId: string,
	target: "ready" | "none",
) =>
	pollUntil(
		`entity '${entityId}' translationStatus=${target}`,
		Effect.gen(function* () {
			const entity = yield* getEntity(client, entityId);
			return entity.translationStatus === target ? entity : null;
		}),
	);
