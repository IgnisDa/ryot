import { Schema } from "@ryot-app/plugin-kit/effect";
import {
	add,
	and,
	castBoolean,
	castDate,
	castNumber,
	castText,
	coalesce,
	column,
	conditional,
	count,
	eq,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonPath,
	literal,
	localDate,
	NullableNumber,
	or,
	parameters,
	ProjectionProcessing,
	projectionProcessing,
	schemaOwnerPredicate,
	selectedField,
	sum,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import type { ReportingWindow } from "@ryot-app/plugin-kit/ryotql";
import type { PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { CALENDAR_DATE_TOLERANCE_DAYS } from "./consumption";
import type { ConsumptionMeasureUnit } from "./consumption-allocation";
import { consumptionEventSlugs } from "./consumption-projection";
import { propertyBoolean, propertyText } from "./entity-selections";

type Table = Parameters<typeof column>[0];
export const consumptionValue = (event: Table, ...path: string[]) =>
	jsonPath(column(event, "projection"), "contribution", ...path);
export const consumptionNumber = (event: Table, ...path: string[]) =>
	castNumber(consumptionValue(event, ...path));
export const consumptionRows = (event: Table) =>
	inArray(column(event, "eventSchemaSlug"), consumptionEventSlugs.map(literal));
export const consumptionReady = (event: Table) => isNotNull(consumptionValue(event));
export const consumptionAmount = (event: Table, unit: ConsumptionMeasureUnit) =>
	add(
		coalesce(consumptionNumber(event, unit, "recorded"), literal(0)),
		coalesce(consumptionNumber(event, unit, "estimated"), literal(0)),
	);

/** The local calendar date of an observation: date-only evidence keeps its recorded date. */
export const consumptionActiveDay = (
	event: Table,
	timeZone: Parameters<typeof localDate>[1]["timeZone"],
) => {
	const kind = castText(consumptionValue(event, "attribution", "kind"));
	const value = consumptionValue(event, "attribution", "value");
	return conditional(
		eq(kind, literal("date")),
		castText(value),
		conditional(
			eq(kind, literal("instant")),
			localDate(castDate(value), { timeZone }),
			literal(null),
		),
	);
};
export const consumptionPeriod = (event: Table, period: ReportingWindow) => {
	const calendarDate = propertyText(event, "calendarDate");
	return and(
		consumptionReady(event),
		period.superset(column(event, "occurredAt"), CALENDAR_DATE_TOLERANCE_DAYS + 1),
		or(
			period.unbounded,
			and(
				eq(coalesce(propertyBoolean(event, "dateUnknown"), literal(false)), literal(false)),
				or(
					and(isNotNull(calendarDate), period.dateWhere(calendarDate)),
					and(isNull(calendarDate), period.where(column(event, "occurredAt"))),
				),
			),
		),
	);
};

export const mediaConsumptionTotalsSelection = (entity: Table, unit: ConsumptionMeasureUnit) => {
	const event = table("event", "consumptionTotalsEvent");
	const scope = and(
		eq(column(event, "entityId"), column(entity, "id")),
		eq(column(event, "eventSchemaPluginId"), column(entity, "entitySchemaPluginId")),
		consumptionRows(event),
	);
	return consumptionTotalsSelection(event, scope, unit);
};

export const consumptionTotalsSelection = (
	event: Table,
	scope: ReturnType<typeof and>,
	unit: ConsumptionMeasureUnit,
) => {
	const ready = and(scope, consumptionReady(event));
	return {
		consumptionProcessing: selectedField(projectionProcessing(event, scope), ProjectionProcessing),
		consumedAmount: selectedField(
			sum(event, consumptionAmount(event, unit), { where: ready }),
			NullableNumber,
		),
		completionCount: selectedField(
			coalesce(
				sum(event, consumptionNumber(event, "titleCompletions"), { where: ready }),
				literal(0),
			),
			Schema.Finite,
		),
		unknownAmountCount: selectedField(
			count(event, {
				where: and(ready, eq(castBoolean(consumptionValue(event, unit, "missing")), literal(true))),
			}),
			Schema.Finite,
		),
	};
};

export type ConsumptionScope = {
	readonly entityId?: string | undefined;
	readonly reference: PluginIdentityReference;
};
export const consumptionScopeParameterFields = {
	entityId: { type: "string", label: "Title", description: "Restrict activity to this title" },
} as const;
const scopeParameters = parameters({ fields: consumptionScopeParameterFields });
export const consumptionScope = (event: Table, input: Pick<ConsumptionScope, "reference">) =>
	and(
		schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
		scopeParameters.whenSet(
			"entityId",
			eq(column(event, "entityId"), scopeParameters.value("entityId")),
		),
	);

export const consumptionDetail = (
	input: ConsumptionScope,
	alias: string,
	period: ReportingWindow,
) => {
	const event = table("event", `${alias}Event`);
	const entity = table("entity", `${alias}Entity`);
	return {
		event,
		entity,
		joins: [join("inner", entity, eq(column(entity, "id"), column(event, "entityId")))],
		where: and(
			consumptionScope(event, input),
			consumptionRows(event),
			consumptionPeriod(event, period),
		),
	};
};

export const mediaTypeJoin = (entity: Table, alias: string, reference: PluginIdentityReference) => {
	const schema = table("entitySchema", alias);
	return {
		label: selectedField(column(schema, "name"), Schema.String),
		slug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
		join: join(
			"inner",
			schema,
			and(
				eq(column(schema, "slug"), column(entity, "entitySchemaSlug")),
				schemaOwnerPredicate(schema, "pluginId", reference),
			),
		),
	};
};
