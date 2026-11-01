import type { Predicate, TableReference } from "@ryot-app/contract/modules/ryotql/language";
import { and, column, conditional, countIf, eq, exists, literal } from "@ryot-app/ryotql";
import { Schema } from "effect";

export const ProjectionProcessing = Schema.Literals(["ready", "pending", "failed"]);
export type ProjectionProcessing = typeof ProjectionProcessing.Type;

const hasStatus = (source: TableReference, status: "failed" | "pending") =>
	eq(column(source, "projectionStatus"), literal(status));

export const projectionStatusMeasures = (source: TableReference) => ({
	failed: countIf(hasStatus(source, "failed")),
	pending: countIf(hasStatus(source, "pending")),
});

export const projectionProcessingState = (counts: {
	readonly failed: null | number;
	readonly pending: null | number;
}): ProjectionProcessing => {
	if ((counts.failed ?? 0) > 0) {
		return "failed";
	}
	return (counts.pending ?? 0) > 0 ? "pending" : "ready";
};

export const projectionProcessing = (source: TableReference, where: Predicate) =>
	conditional(
		exists(source, { where: and(where, hasStatus(source, "failed")) }),
		literal("failed"),
		conditional(
			exists(source, { where: and(where, hasStatus(source, "pending")) }),
			literal("pending"),
			literal("ready"),
		),
	);
