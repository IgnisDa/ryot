import { calendarSourceDocument } from "@ryot-app/contract/modules/calendar-sources/schemas";
import { definitionKey } from "@ryot-app/contract/modules/plugins/references";
import type { FieldSelection } from "@ryot-app/contract/modules/ryotql/language";

import { getCatalogTable } from "#modules/ryotql/catalog";
import {
	queryExpressionKind,
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "#modules/ryotql/validator";

import type { CalendarSourceDefinition } from "./snapshot";

const namedFieldKinds = [
	["startAt", "date"],
	["caption", "text"],
	["art", "json"],
	["done", "boolean"],
] as const;

const subjectTable = ({ query, subject }: CalendarSourceDefinition) => {
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

export const calendarSourceIssue = (source: CalendarSourceDefinition): string | undefined => {
	const { query, subject } = source;
	if ("orderBy" in query.output || "pagination" in query.output) {
		return "ordering and pagination are owned by the kernel";
	}
	const { error: queryIssue } = validateRyotQLDocument(
		calendarSourceDocument(query),
		savedViewDataSourceAccess,
	);
	if (queryIssue) {
		return queryIssue;
	}
	for (const [name, kind] of namedFieldKinds) {
		const key = source[name];
		if (key === null) {
			continue;
		}
		const field = query.output.fields.find(
			(selection): selection is FieldSelection => "key" in selection && selection.key === key,
		);
		if (!field) {
			return `${name} field '${key}' must be a projected field`;
		}
		if (queryExpressionKind(query, field.expr, savedViewDataSourceAccess) !== kind) {
			return `${name} field '${key}' must be a ${kind} expression`;
		}
	}
	const table = subjectTable(source);
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
