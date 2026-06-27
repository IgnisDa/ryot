import type {
	FieldSelection,
	NamedQuery,
	RowsOutput,
	RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import { and, contains, literal } from "@ryot-app/ryotql";
import type { SavedViewRecord } from "@ryot-app/ryotql-recipes/saved-view-records";

export type SavedViewLayoutDefinition = NonNullable<SavedViewRecord["layouts"]>[keyof NonNullable<
	SavedViewRecord["layouts"]
>];

type RowsQuery = Omit<NamedQuery, "output"> & { readonly output: RowsOutput };

const isRowsQuery = (query: NamedQuery): query is RowsQuery => query.output.type === "rows";

export const normalizeSavedViewSearch = (search: string) =>
	search
		.trim()
		.split(/[\s_-]+/)
		.filter(Boolean)
		.join(" ");

const onlyRowsQuery = (
	queryDocument: RyotQLDocument,
): { readonly query: RowsQuery; readonly queryName: string } | undefined => {
	const entries = Object.entries(queryDocument.queries);
	if (entries.length !== 1) {
		return undefined;
	}
	const queryEntry = entries.at(0);
	if (queryEntry === undefined) {
		return undefined;
	}
	const [queryName, query] = queryEntry;
	if (!isRowsQuery(query)) {
		return undefined;
	}
	return { query, queryName };
};

export const withSavedViewSearch = (
	queryDocument: RyotQLDocument,
	layout: SavedViewLayoutDefinition,
	search: string,
) => {
	const normalizedSearch = normalizeSavedViewSearch(search);
	if (normalizedSearch.length === 0) {
		return queryDocument;
	}

	const mappedField = "columns" in layout ? layout.columns.at(0)?.field : layout.titleField;
	if (typeof mappedField !== "string") {
		return queryDocument;
	}

	const queryEntry = onlyRowsQuery(queryDocument);
	if (queryEntry === undefined) {
		return queryDocument;
	}
	const { query, queryName } = queryEntry;
	const selectedField = query.output.fields.find(
		(selection): selection is FieldSelection => "key" in selection && selection.key === mappedField,
	);
	if (selectedField === undefined) {
		return queryDocument;
	}

	const searchPredicate = and(
		...normalizedSearch.split(" ").map((token) => contains(selectedField.expr, literal(token))),
	);
	const pagination = { ...query.output.pagination };
	delete pagination.after;
	return {
		...queryDocument,
		queries: {
			...queryDocument.queries,
			[queryName]: {
				...query,
				output: { ...query.output, pagination },
				where: query.where ? and(query.where, searchPredicate) : searchPredicate,
			},
		},
	};
};

export const withSavedViewCursor = (queryDocument: RyotQLDocument, after: string | undefined) => {
	const queryEntry = onlyRowsQuery(queryDocument);
	if (queryEntry === undefined) {
		return queryDocument;
	}
	const { query, queryName } = queryEntry;
	const pagination = { ...query.output.pagination };
	if (after === undefined) {
		delete pagination.after;
	} else {
		pagination.after = after;
	}
	return {
		...queryDocument,
		queries: {
			...queryDocument.queries,
			[queryName]: { ...query, output: { ...query.output, pagination } },
		},
	};
};

export const savedViewQueryIdentity = (
	record: Pick<SavedViewRecord, "id" | "updatedAt">,
	search: string,
) => JSON.stringify([record.id, record.updatedAt, normalizeSavedViewSearch(search)]);
