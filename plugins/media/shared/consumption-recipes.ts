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
	gte,
	inArray,
	isNotNull,
	isNull,
	join,
	jsonPath,
	literal,
	localDate,
	lte,
	not,
	or,
	schemaOwnerPredicate,
	selectedField,
	sum,
	table,
	withinPeriod,
} from "@ryot-app/plugin-kit/ryotql";
import type {
	PluginIdentityReference,
	ReportingPeriod,
	TimeZone,
} from "@ryot-app/plugin-kit/schema";

import type { ConsumptionMeasureUnit } from "./consumption-allocation";
import { consumptionEventSlugs } from "./consumption-projection";
import { propertyBoolean, propertyText } from "./entity-selections";

type Table = ReturnType<typeof table>;
export const consumptionValue = (event: Table, ...path: string[]) =>
	jsonPath(column(event, "projection"), "contribution", ...path);
export const consumptionNumber = (event: Table, ...path: string[]) =>
	castNumber(consumptionValue(event, ...path));
export const consumptionRows = (event: Table) =>
	inArray(column(event, "eventSchemaSlug"), consumptionEventSlugs.map(literal));
/** Event projections are only visible while their stream is ready. */
export const consumptionReady = (event: Table) => isNotNull(consumptionValue(event));
export const consumptionAmount = (event: Table, unit: ConsumptionMeasureUnit) =>
	add(
		coalesce(consumptionNumber(event, unit, "recorded"), literal(0)),
		coalesce(consumptionNumber(event, unit, "estimated"), literal(0)),
	);

/** The local calendar date of an observation: date-only evidence keeps its recorded date. */
export const consumptionActiveDay = (event: Table, timeZone: TimeZone) => {
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

export const consumptionPeriod = (event: Table, period: null | ReportingPeriod) => {
	if (period === null) {
		return consumptionReady(event);
	}
	const kind = castText(consumptionValue(event, "attribution", "kind"));
	const date = castText(consumptionValue(event, "attribution", "value"));
	const calendarDate = propertyText(event, "calendarDate");
	return and(
		consumptionReady(event),
		eq(coalesce(propertyBoolean(event, "dateUnknown"), literal(false)), literal(false)),
		or(
			and(gte(calendarDate, literal(period.startDate)), lte(calendarDate, literal(period.endDate))),
			and(isNull(calendarDate), withinPeriod(column(event, "occurredAt"), period)),
		),
		or(
			and(eq(kind, literal("instant")), withinPeriod(castDate(date), period)),
			and(
				eq(kind, literal("date")),
				gte(date, literal(period.startDate)),
				lte(date, literal(period.endDate)),
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
		consumptionPendingCount: selectedField(
			count(event, { where: and(scope, not(consumptionReady(event))) }),
			Schema.Finite,
		),
		consumedAmount: selectedField(
			sum(event, consumptionAmount(event, unit), { where: ready }),
			Schema.NullOr(Schema.Finite),
		),
		consumptionFailedCount: selectedField(
			count(event, { where: and(scope, eq(column(event, "projectionStatus"), literal("failed"))) }),
			Schema.Finite,
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

export const consumptionScope = (event: Table, input: ConsumptionScope) =>
	and(
		schemaOwnerPredicate(event, "eventSchemaPluginId", input.reference),
		...(input.entityId === undefined
			? []
			: [eq(column(event, "entityId"), literal(input.entityId))]),
	);

export const consumptionDetail = (
	input: ConsumptionScope,
	alias: string,
	period: null | ReportingPeriod,
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
