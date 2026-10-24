import {
	BROWSE_SUBJECT_ALIAS,
	browseExpressionDocument,
	type BrowseField,
	type EntitySchemaBrowse,
} from "@ryot-app/contract/modules/filters/browse";
import type { FilterValueType } from "@ryot-app/contract/modules/filters/schemas";
import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import { reservedBrowseFieldKeys } from "@ryot-app/ryotql-recipes/browse";

import {
	queryExpressionKind,
	savedViewDataSourceAccess,
	validateRyotQLDocument,
} from "#modules/ryotql/validator";

const expectedKinds: Record<FilterValueType, string> = {
	text: "text",
	enum: "text",
	date: "date",
	number: "number",
	boolean: "boolean",
	"text-list": "json",
	"enum-list": "json",
};

const expressionIssue = (
	key: string,
	expression: ScalarExpression,
	accepts: (kind: string | undefined) => boolean,
) => {
	const { error } = validateRyotQLDocument(
		browseExpressionDocument(expression),
		savedViewDataSourceAccess,
	);
	if (error) {
		return `browse field '${key}' expression is invalid: ${error}`;
	}
	const kind = queryExpressionKind(
		{ from: { table: "entity", alias: BROWSE_SUBJECT_ALIAS } },
		expression,
		savedViewDataSourceAccess,
	);
	return accepts(kind) ? undefined : `browse field '${key}' expression has kind '${kind}'`;
};

const browseKeyPattern = /^[a-z][A-Za-z0-9]*$/;

export const browseIssue = (browse: EntitySchemaBrowse): string | undefined => {
	const keys = new Set<string>();
	for (const browseField of browse.fields) {
		if (!browseKeyPattern.test(browseField.key)) {
			return `browse field key '${browseField.key}' must be camelCase letters and digits`;
		}
		if (reservedBrowseFieldKeys.includes(browseField.key)) {
			return `browse field key '${browseField.key}' is reserved`;
		}
		if (keys.has(browseField.key)) {
			return `browse field key '${browseField.key}' must be unique`;
		}
		keys.add(browseField.key);
		if (browseField.kind === "sort") {
			const issue = expressionIssue(
				browseField.key,
				browseField.expression,
				(kind) => kind !== undefined && kind !== "json",
			);
			if (issue) {
				return issue;
			}
			continue;
		}
		if (browseField.kind !== "value") {
			continue;
		}
		if ("choices" in browseField) {
			const values = browseField.choices.map(({ value }) => value);
			if (new Set(values).size !== values.length) {
				return `browse field '${browseField.key}' choices must be unique`;
			}
		}
		const listType = browseField.type === "enum-list" || browseField.type === "text-list";
		if (listType && browseField.sort) {
			return `browse field '${browseField.key}' of type ${browseField.type} cannot be sorted`;
		}
		const issue = expressionIssue(
			browseField.key,
			browseField.expression,
			(kind) => kind === expectedKinds[browseField.type],
		);
		if (issue) {
			return issue;
		}
	}
	return undefined;
};

const browseFieldShape = (browseField: BrowseField) => {
	if (browseField.kind === "value") {
		return `value:${browseField.type}`;
	}
	return browseField.kind === "relationship"
		? `relationship:${browseField.direction}`
		: browseField.kind;
};

/** Browse fields sharing a key across one source's entity schemas must merge consistently. */
export const browseConsistencyIssue = (
	entitySchemas: readonly {
		readonly slug: string;
		readonly browse?: undefined | EntitySchemaBrowse;
	}[],
): string | undefined => {
	const shapes = new Map<string, { readonly slug: string; readonly shape: string }>();
	for (const entitySchema of entitySchemas) {
		for (const browseField of entitySchema.browse?.fields ?? []) {
			const shape = browseFieldShape(browseField);
			const existing = shapes.get(browseField.key);
			if (existing && existing.shape !== shape) {
				return `Browse field '${browseField.key}' differs between entity schemas ${existing.slug} and ${entitySchema.slug}`;
			}
			shapes.set(browseField.key, { shape, slug: entitySchema.slug });
		}
	}
	return undefined;
};
