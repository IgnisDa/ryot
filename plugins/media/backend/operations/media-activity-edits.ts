import {
	deleteEventChange,
	expectedEventFields,
	type ScriptHost,
} from "@ryot-app/plugin-backend-sdk/core";
import { Array, Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	eventSchemaPredicate,
	executeRyotqlRecipe,
	inArray,
	join,
	or,
	parameters,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import type { LocalMessage } from "@ryot-app/plugin-kit/messages";
import { EventId } from "@ryot-app/plugin-kit/schema";

import {
	mediaActivityDeclaredProperties,
	mediaActivityEntitySchemaSlugs,
	mediaActivityEventSchemaSlugs,
} from "../../shared/media-activity-fields";
import type { MediaEventSnapshot } from "../../shared/media-activity-operations";
import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import { catalogMessage } from "../../shared/messages.generated";
import { reject } from "../lib/failures";

type EditableCombination = readonly [entitySchemaSlug: string, eventSchemaSlug: string];

const MEDIA_EDIT_PAGE_SIZE = 100;

export const activityCombinations: readonly EditableCombination[] =
	mediaActivityEntitySchemaSlugs.flatMap((entity) =>
		mediaActivityEventSchemaSlugs.flatMap((event) =>
			mediaActivityDeclaredProperties(entity, event) === undefined
				? []
				: [[entity, event] as const],
		),
	);

export const reviewCombinations: readonly EditableCombination[] =
	mediaLibraryMemberEntitySchemaSlugs.map((entity) => [entity, "review"] as const);
const editTargetsRecipe = (input: { readonly combinations: readonly EditableCombination[] }) => {
	const inputParameters = parameters({
		fields: {
			ids: {
				type: "array",
				description: "ids to read",
				validation: { required: true },
				label: catalogMessage("query-parameter.ids"),
				items: {
					type: "string",
					description: "Selected ID",
					label: catalogMessage("query-parameter.id"),
				},
			},
		},
	});
	const visible = table("event", "editVisibleEvent");
	const event = table("event", "editTargetEvent");
	const entity = table("entity", "editTargetEntity");
	const byId = (from: typeof event) => inArray(column(from, "id"), inputParameters.list("ids"));
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ allowed, visible: seen }) =>
			Result.succeed({ allowed: allowed.items, visibleIds: seen.items.map(({ id }) => id) }),
		queries: {
			visible: selectedRows(visible, {
				where: byId(visible),
				limit: MEDIA_EDIT_PAGE_SIZE,
				orderBy: [ascending(column(visible, "id"))],
				selection: { id: selectedField(column(visible, "id"), Schema.String) },
			}),
			allowed: selectedRows(event, {
				limit: MEDIA_EDIT_PAGE_SIZE,
				orderBy: [ascending(column(event, "id"))],
				joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
				where: and(
					byId(event),
					or(
						...input.combinations.map(([entitySlug, eventSlug]) =>
							eventSchemaPredicate(event, entity, entitySlug, eventSlug, { kind: "self" }),
						),
					),
				),
				selection: {
					id: selectedField(column(event, "id"), Schema.String),
					eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
					entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
					properties: selectedField(
						column(event, "properties"),
						Schema.Record(Schema.String, Schema.Json),
					),
				},
			}),
		},
	});
};
export type EditTarget = {
	readonly id: string;
	readonly eventSchemaSlug: string;
	readonly entitySchemaSlug: string;
	readonly properties: { readonly [key: string]: Schema.Json };
};

/**
 * Visible records of the allowed media schemas among `ids`. A visible record of any other schema
 * rejects the request; ids that resolve to nothing are absent from the result.
 */
export const loadEditTargets = (
	host: Pick<ScriptHost, "executeRyotql">,
	ids: readonly string[],
	combinations: readonly EditableCombination[],
	disallowed: LocalMessage,
) =>
	Effect.gen(function* () {
		const targets: EditTarget[] = [];
		for (const chunk of Array.chunksOf(ids, MEDIA_EDIT_PAGE_SIZE)) {
			const { allowed, visibleIds } = yield* executeRyotqlRecipe(
				host.executeRyotql,
				editTargetsRecipe({ combinations: combinations }),
				{ ids: chunk },
			);
			const allowedIds = new Set(allowed.map(({ id }) => id));
			if (visibleIds.some((id) => !allowedIds.has(id))) {
				return yield* reject(disallowed);
			}
			targets.push(...allowed);
		}
		return targets;
	});

/** Deletes of the events `ids` names, each checked against `expected` when given. */
export const deleteTargetChanges = (ids: readonly string[], expected?: MediaEventSnapshot) => ({
	events: {
		changes: ids.map((id) =>
			deleteEventChange(
				EventId.make(id),
				expected === undefined ? undefined : expectedEventFields(expected),
			),
		),
	},
});

export const requireDeclaredProperties = (
	target: EditTarget,
	declared: undefined | readonly string[],
) =>
	declared !== undefined && Object.keys(target.properties).every((key) => declared.includes(key))
		? Effect.void
		: reject(catalogMessage("rejection.record.uneditable"));
