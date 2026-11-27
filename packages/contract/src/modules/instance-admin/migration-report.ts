import { Schema } from "effect";

export const MigrationReportLevel = Schema.Literals(["info", "warning"]);
export type MigrationReportLevel = Schema.Schema.Type<typeof MigrationReportLevel>;

// Legacy rows are dropped once the migration finishes, so everything an operator needs to
// understand a skipped record is rendered into the detail at emission.
export const MigrationReportDetail = Schema.Struct({
	key: Schema.String,
	label: Schema.String,
	sentence: Schema.String,
	provenance: Schema.Array(
		Schema.Struct({ key: Schema.String, value: Schema.NullOr(Schema.String) }),
	),
});

export type MigrationReportDetail = Schema.Schema.Type<typeof MigrationReportDetail>;
