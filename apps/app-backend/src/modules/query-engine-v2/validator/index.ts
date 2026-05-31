import type { QueryDocumentV2 } from "../language";
import { validateEntitySource, validateRelationshipSource, validateRootEventSource } from "./core";
import { validateAggregateOutput, validateRowsOutput, validateTimeSeriesOutput } from "./output";
import type { AliasScope } from "./shared";

export const validateQueryDocumentV2 = (doc: QueryDocumentV2): string | null => {
	const scope: AliasScope = new Map();
	const aliases: AliasScope = new Map();
	const { source } = doc;
	if (source.type === "entities" && source.via !== undefined) {
		return "Root entity source cannot specify via";
	}
	const sourceError =
		source.type === "entities"
			? validateEntitySource(source, scope, aliases)
			: source.type === "events"
				? validateRootEventSource(source, scope, aliases)
				: validateRelationshipSource(source, scope, aliases);
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
