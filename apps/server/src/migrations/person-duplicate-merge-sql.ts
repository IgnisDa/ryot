import { legacyPersonCompanyPredicateSql } from "./person-mapping-entity-sql";
import {
	buildAnomalyReportSql,
	buildReportDetailSql,
	buildRequireLegacyTableSql,
	quoteSqlString,
} from "./shared";

const phase = "legacy person identities";

const referencingTables = [
	{ survivorOrder: "", table: "metadata_to_person", keyColumns: ["metadata_id", "role"] },
	{
		survivorOrder: "",
		table: "metadata_group_to_person",
		keyColumns: ["metadata_group_id", "role"],
	},
	{ survivorOrder: "", table: "old_entity_translation", keyColumns: ["language", "variant"] },
	{ table: "user_to_entity", keyColumns: ["user_id"], survivorOrder: "linked.created_on, " },
	{
		table: "collection_to_entity",
		keyColumns: ["collection_id"],
		survivorOrder: "linked.created_on, ",
	},
	{ keyColumns: [], table: "review", survivorOrder: "" },
] as const;

const buildCollapseLinksSql = ({
	table,
	keyColumns,
	survivorOrder,
}: (typeof referencingTables)[number]) => {
	const repointSql = `
	UPDATE "${table}" linked
	SET person_id = duplicate.canonical_id
	FROM _legacy_person_duplicates duplicate
	WHERE linked.person_id = duplicate.id;`;
	if (keyColumns.length === 0) {
		return repointSql;
	}
	return `
	WITH ranked AS (
		SELECT linked.ctid AS row_ctid,
			row_number() OVER (
				PARTITION BY ${keyColumns.map((column) => `linked.${column}`).join(", ")},
					COALESCE(duplicate.canonical_id, linked.person_id)
				ORDER BY ${survivorOrder}duplicate.id IS NOT NULL, linked.person_id
			) AS position
		FROM "${table}" linked
		LEFT JOIN _legacy_person_duplicates duplicate ON duplicate.id = linked.person_id
		WHERE linked.person_id IN (
			SELECT id FROM _legacy_person_duplicates
			UNION SELECT canonical_id FROM _legacy_person_duplicates
		)
	)
	DELETE FROM "${table}" linked
	USING ranked
	WHERE linked.ctid = ranked.row_ctid AND ranked.position > 1;
${repointSql}`;
};

// V1 keys people by (identifier, source, source_specifics), so rows differing only in
// source_specifics share one V2 entity identity and must collapse before any phase reads them.
export const buildLegacyPersonDuplicateMergeSql = () => `
DO $$
DECLARE
	merged_report_seq int;
	merged_count int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${buildRequireLegacyTableSql(phase, "person")}
	${referencingTables.map(({ table }) => buildRequireLegacyTableSql(phase, table)).join("")}

	CREATE TEMP TABLE _legacy_person_duplicates ON COMMIT DROP AS
	SELECT ranked.*
	FROM (
		SELECT legacy_person.id, legacy_person.name, legacy_person.source, legacy_person.identifier,
			legacy_person.created_by_user_id, legacy_person.source_specifics,
			first_value(legacy_person.id) OVER identity AS canonical_id
		FROM "person" legacy_person
		WINDOW identity AS (
			PARTITION BY legacy_person.source, legacy_person.identifier,
				legacy_person.created_by_user_id, ${legacyPersonCompanyPredicateSql("legacy_person")}
			ORDER BY legacy_person.created_on, legacy_person.id
		)
	) ranked
	WHERE ranked.id <> ranked.canonical_id;

	${buildAnomalyReportSql({
		phase,
		countVariable: "merged_count",
		seqVariable: "merged_report_seq",
		code: "person-identity-duplicate-merged",
		source: "_legacy_person_duplicates duplicate",
		message:
			"Legacy people or companies that differed only in provider-specific flags were merged into the earliest row with the same identity, because V2 allows one entity per provider identity. Each merged row is listed below.",
		detail: buildReportDetailSql({
			key: "duplicate.id",
			label: "duplicate.name",
			sentence: quoteSqlString(
				"This row duplicated another legacy row's provider identity, so its references now point at that row.",
			),
			provenance: [
				["Legacy row", "duplicate.id"],
				["Merged into", "duplicate.canonical_id"],
				["Source", "duplicate.source"],
				["Identifier", "duplicate.identifier"],
				["Creator", "duplicate.created_by_user_id"],
				["Source specifics", "duplicate.source_specifics"],
			],
		}),
	})}

	${referencingTables.map(buildCollapseLinksSql).join("\n")}

	DELETE FROM "person" legacy_person
	USING _legacy_person_duplicates duplicate
	WHERE legacy_person.id = duplicate.id;
END $$;
`;
