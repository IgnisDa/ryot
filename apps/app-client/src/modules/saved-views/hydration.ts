import { type FieldSelection, RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import { and, inArray, literal } from "@ryot/ryotql";
import { Schema } from "effect";

export const buildSavedViewHydrationDocument = (input: {
	readonly entityIdField: string;
	readonly entityIds: readonly string[];
	readonly queryDocument: RyotQLDocument;
}) => {
	if (input.entityIds.length === 0) {
		throw new TypeError("Saved-view hydration requires at least one entity ID");
	}

	const queryDocument = Schema.decodeUnknownSync(RyotQLDocument)(input.queryDocument);
	const queryEntries = Object.entries(queryDocument.queries);
	if (queryEntries.length !== 1) {
		throw new TypeError("Saved-view hydration requires exactly one query");
	}

	const [[queryName, query]] = queryEntries;
	if (query.output.type !== "rows") {
		throw new TypeError("Saved-view hydration requires a rows query");
	}

	const entityIdFields = query.output.fields.filter(
		(field): field is FieldSelection => "key" in field && field.key === input.entityIdField,
	);
	if (entityIdFields.length !== 1) {
		throw new TypeError("Saved-view hydration requires exactly one projected entity ID field");
	}

	const entityIdPredicate = inArray(entityIdFields[0].expr, input.entityIds.map(literal));
	return {
		...queryDocument,
		queries: {
			[queryName]: {
				...query,
				output: { ...query.output, pagination: { limit: input.entityIds.length } },
				where: query.where ? and(query.where, entityIdPredicate) : entityIdPredicate,
			},
		},
	} satisfies RyotQLDocument;
};
