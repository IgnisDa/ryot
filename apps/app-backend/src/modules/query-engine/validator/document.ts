import type { QueryDocument } from "../language";
import { validateEntitySource, validateRelationshipSource, validateRootEventSource } from "./core";
import { validateAggregateOutput, validateRowsOutput, validateTimeSeriesOutput } from "./output";
import type { AliasScope } from "./shared";

const runValidation = (
	doc: QueryDocument,
	scope: AliasScope,
	aliases: AliasScope,
): string | null => {
	const { source } = doc;
	if (source.type === "entities" && source.via !== undefined) {
		return "Root entity source cannot specify via";
	}
	let sourceError: string | null;
	switch (source.type) {
		case "entities":
			sourceError = validateEntitySource(source, scope, aliases);
			break;
		case "events":
			sourceError = validateRootEventSource(source, scope, aliases);
			break;
		case "relationships":
			sourceError = validateRelationshipSource(source, scope, aliases);
			break;
	}
	if (sourceError) {
		return sourceError;
	}

	if (
		source.type === "relationships" &&
		doc.output.type === "rows" &&
		(doc.output.include?.length ?? 0) > 0
	) {
		return "Relationship root rows do not support include yet";
	}

	if (doc.output.type === "rows") {
		return validateRowsOutput(doc.output, scope, aliases);
	}
	if (doc.output.type === "aggregate") {
		return validateAggregateOutput(doc.output, scope, aliases);
	}
	return validateTimeSeriesOutput(doc.output, scope, aliases);
};

export const validateQueryDocumentWithScope = (
	doc: QueryDocument,
): { error: string | null; scope: AliasScope } => {
	const scope: AliasScope = new Map();
	const error = runValidation(doc, new Map(), scope);
	return { error, scope };
};

export const validateQueryDocument = (doc: QueryDocument): string | null =>
	validateQueryDocumentWithScope(doc).error;

export const collectAliasScope = (doc: QueryDocument): AliasScope =>
	validateQueryDocumentWithScope(doc).scope;
