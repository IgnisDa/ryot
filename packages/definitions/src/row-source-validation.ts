import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import { documentReadsClock, documentTables } from "@ryot-app/contract/modules/ryotql/authored";
import type { FieldSelection, NamedQuery } from "@ryot-app/contract/modules/ryotql/language";
import {
	rowSourceDocument,
	type RowSourceQuery,
} from "@ryot-app/contract/modules/ryotql/row-source";
import type { SavedViewSubject } from "@ryot-app/contract/modules/saved-views/schemas";
import { authoredValidationBranches, storedValidationContext } from "@ryot-app/ryotql/binding";
import { dataChangeTables } from "@ryot-app/ryotql/catalog";
import {
	queryExpressionKind,
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "@ryot-app/ryotql/validator";
import { Result } from "effect";

import type { SignalScheduleDefinition } from "./signal-schedules";
import type { CalendarSourceDefinition } from "./snapshot";

type FieldCheck = readonly [name: string, key: null | string, kind: null | string];

const subjectTable = (query: NamedQuery, subject: SavedViewSubject) => {
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
	const projections = authoredValidationBranches(
		rowSourceDocument(query),
		storedValidationContext(() =>
			Result.fail(new Error("Stored row sources cannot select another source")),
		),
	);
	if (Result.isFailure(projections)) {
		return projections.failure.message;
	}
	for (const document of projections.success) {
		const { error: queryIssue } = validateRyotQLDocument(document, savedViewDataSourceAccess);
		if (queryIssue) {
			return queryIssue;
		}
		const boundQuery = document.queries["source"];
		if (boundQuery?.output.type !== "rows") {
			return "Row source must produce rows";
		}
		for (const [name, key, kind] of fieldChecks) {
			if (key === null) {
				continue;
			}
			const field = boundQuery.output.fields.find(
				(selection): selection is FieldSelection => "key" in selection && selection.key === key,
			);
			if (!field) {
				return `${name} field '${key}' must be a projected field`;
			}
			if (
				kind !== null &&
				queryExpressionKind(boundQuery, field.expr, savedViewDataSourceAccess) !== kind
			) {
				return `${name} field '${key}' must be a ${kind} expression`;
			}
		}
		const table = subjectTable(boundQuery, subject);
		if (table !== "entity") {
			return `subject alias '${subject.entityAlias}' must be an entity table in the query`;
		}
	}

	const subjectKeys = subject.schemas.map(({ slug, owner }) =>
		definitionKey("entity", owner, slug),
	);
	if (new Set(subjectKeys).size !== subjectKeys.length) {
		return "subject schemas must not contain duplicates";
	}
	return undefined;
};

const timeBindingIssue = (source: {
	readonly precision: string;
	readonly instantAt?: string | undefined;
}) =>
	source.instantAt !== undefined && source.precision !== "date"
		? "instantAt requires a date-precision source"
		: undefined;

export const calendarSourceIssue = (source: CalendarSourceDefinition) =>
	timeBindingIssue(source) ??
	rowSourceIssue(source, [
		["startAt", source.startAt, "date"],
		["instantAt", source.instantAt ?? null, "date"],
		["art", source.art, "json"],
		["done", source.done, "boolean"],
		...Object.entries(source.caption?.params ?? {}).map(
			([name, key]) => [`caption argument ${name}`, key, null] as const,
		),
	]);

export const signalScheduleIssue = (
	schedule: Omit<SignalScheduleDefinition, "readSchemaSlugs">,
) => {
	const timeIssue = timeBindingIssue(schedule);
	if (timeIssue !== undefined) {
		return timeIssue;
	}
	const document = rowSourceDocument(schedule.query);
	if (documentReadsClock(document)) {
		return "query must not read the clock; the kernel owns the due window";
	}
	const table = [...documentTables(document)].find((name) => !dataChangeTables.has(name));
	if (table !== undefined) {
		return `query must read only entity, relationship and event tables, not '${table}'`;
	}
	return rowSourceIssue(schedule, [
		["dueAt", schedule.dueAt, "date"],
		["instantAt", schedule.instantAt ?? null, "date"],
		["occurrence", schedule.occurrence, "text"],
		["confirmedAt", schedule.freshness?.confirmedAt ?? null, "date"],
		...Object.entries(schedule.properties).map(
			([property, key]) => [`property ${property}`, key, null] as const,
		),
	]);
};
