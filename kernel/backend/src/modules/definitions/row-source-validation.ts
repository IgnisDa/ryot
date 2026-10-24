import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import type { FieldSelection } from "@ryot-app/contract/modules/ryotql/language";
import {
	rowSourceDocument,
	type RowSourceQuery,
} from "@ryot-app/contract/modules/ryotql/row-source";
import type { SavedViewSubject } from "@ryot-app/contract/modules/saved-views/schemas";

import { getCatalogTable } from "#modules/ryotql/catalog";
import {
	queryExpressionKind,
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "#modules/ryotql/validator";

import type { SignalScheduleDefinition } from "./signal-schedules";
import type { CalendarSourceDefinition } from "./snapshot";

type FieldCheck = readonly [name: string, key: null | string, kind: null | string];

const subjectTable = (query: RowSourceQuery, subject: SavedViewSubject) => {
	if (query.from.alias === subject.entityAlias) {
		return query.from.table;
	}
	for (const join of query.joins ?? []) {
		if (join.type !== "jsonElements" && join.table.alias === subject.entityAlias) {
			return join.table.table;
		}
	}
	return undefined;
};

const rowSourceIssue = (
	{ query, subject }: { readonly query: RowSourceQuery; readonly subject: SavedViewSubject },
	fieldChecks: ReadonlyArray<FieldCheck>,
): string | undefined => {
	if ("orderBy" in query.output || "pagination" in query.output) {
		return "ordering and pagination are owned by the kernel";
	}
	const { error: queryIssue } = validateRyotQLDocument(
		rowSourceDocument(query),
		savedViewDataSourceAccess,
	);
	if (queryIssue) {
		return queryIssue;
	}
	for (const [name, key, kind] of fieldChecks) {
		if (key === null) {
			continue;
		}
		const field = query.output.fields.find(
			(selection): selection is FieldSelection => "key" in selection && selection.key === key,
		);
		if (!field) {
			return `${name} field '${key}' must be a projected field`;
		}
		if (
			kind !== null &&
			queryExpressionKind(query, field.expr, savedViewDataSourceAccess) !== kind
		) {
			return `${name} field '${key}' must be a ${kind} expression`;
		}
	}
	const table = subjectTable(query, subject);
	if (table === undefined || getCatalogTable(table)?.name !== "entity") {
		return `subject alias '${subject.entityAlias}' must be an entity table in the query`;
	}
	const subjectKeys = subject.schemas.map(({ slug, owner }) =>
		definitionKey("entity", owner, slug),
	);
	if (new Set(subjectKeys).size !== subjectKeys.length) {
		return "subject schemas must not contain duplicates";
	}
	return undefined;
};

export const calendarSourceIssue = (source: CalendarSourceDefinition) =>
	rowSourceIssue(source, [
		["startAt", source.startAt, "date"],
		["caption", source.caption, "text"],
		["art", source.art, "json"],
		["done", source.done, "boolean"],
	]);

export const signalScheduleIssue = (schedule: SignalScheduleDefinition) =>
	rowSourceIssue(schedule, [
		["dueAt", schedule.dueAt, "date"],
		["occurrence", schedule.occurrence, "text"],
		["confirmedAt", schedule.freshness?.confirmedAt ?? null, "date"],
		...Object.entries(schedule.properties).map(
			([property, key]) => [`property ${property}`, key, null] as const,
		),
	]);
