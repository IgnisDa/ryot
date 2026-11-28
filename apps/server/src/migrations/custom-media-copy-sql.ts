import {
	buildAnomalyReportSql,
	buildReportDetailSql,
	buildRequireLegacyTableSql,
	quoteSqlString,
} from "./shared";

const phase = "legacy custom media ownership";

const legacyTables = [
	"metadata",
	"seen",
	"review",
	"user_to_entity",
	"collection",
	"collection_to_entity",
	"metadata_to_genre",
	"person",
	"metadata_to_person",
	"metadata_group",
	"metadata_to_metadata_group",
] as const;

const buildCopyLinksSql = (table: string, ownerJoin: string) => `
	INSERT INTO "${table}"
	SELECT (jsonb_populate_record(link, jsonb_build_object('metadata_id', copied.copy_id))).*
	FROM _legacy_custom_media_copies copied
	INNER JOIN "${table}" link ON link.metadata_id = copied.original_id
	${ownerJoin};`;

const buildRepointSql = (table: string) => `
	UPDATE "${table}" reference
	SET metadata_id = copied.copy_id
	FROM _legacy_custom_media_copies copied
	WHERE reference.metadata_id = copied.original_id AND reference.user_id = copied.user_id;`;

// A V2 entity has one owner, so a user's records on custom media another user created would point
// at an entity that user cannot read. Each such user gets an owned copy, and their records move to
// it before any phase reads them.
export const buildLegacyCustomMediaCopySql = () => `
DO $$
DECLARE
	copied_report_seq int;
	copied_count int;
	started_at timestamptz := clock_timestamp();
BEGIN
	${legacyTables.map((table) => buildRequireLegacyTableSql(phase, table)).join("")}

	CREATE TEMP TABLE _legacy_custom_media_copies ON COMMIT DROP AS
	SELECT original.id AS original_id, original.title, original.lot,
		original.created_by_user_id AS owner_id, reference.user_id,
		md5(jsonb_build_array('legacy-custom-media-copy', original.id, reference.user_id)::text) AS copy_id,
		count(*) FILTER (WHERE reference.kind = 'seen') AS seen_rows,
		count(*) FILTER (WHERE reference.kind = 'review') AS review_rows,
		count(*) FILTER (WHERE reference.kind = 'library') AS library_rows,
		count(*) FILTER (WHERE reference.kind = 'collection') AS collection_rows
	FROM (
		SELECT 'seen' AS kind, s.user_id, s.metadata_id FROM "seen" s
		UNION ALL
		SELECT 'review', r.user_id, r.metadata_id FROM "review" r
		UNION ALL
		SELECT 'library', ute.user_id, ute.metadata_id FROM "user_to_entity" ute
		UNION ALL
		SELECT 'collection', coll.user_id, cte.metadata_id
		FROM "collection_to_entity" cte
		INNER JOIN "collection" coll ON coll.id = cte.collection_id
	) reference
	INNER JOIN "metadata" original ON original.id = reference.metadata_id
	WHERE original.source = 'custom' AND original.created_by_user_id <> reference.user_id
	GROUP BY original.id, reference.user_id;

	${buildAnomalyReportSql({
		phase,
		code: "custom-media-copied",
		countVariable: "copied_count",
		seqVariable: "copied_report_seq",
		source: "_legacy_custom_media_copies copied",
		message:
			"Some users had history, reviews, or library or collection entries on custom media that another user created. A V2 item has a single owner, so each of those users now owns a copy of that media and their records point at it; the original stays with its creator. Each copy is listed below.",
		detail: buildReportDetailSql({
			key: "copied.copy_id",
			label: "copied.title",
			provenance: [
				["Copy", "copied.copy_id"],
				["Original", "copied.original_id"],
				["Original owner", "copied.owner_id"],
				["User", "copied.user_id"],
				["Kind", "copied.lot"],
			],
			sentence: `format(${quoteSqlString(
				"This user's records on this media now point at a copy the user owns: %s seen, %s review, %s library and %s collection record(s).",
			)}, copied.seen_rows, copied.review_rows, copied.library_rows, copied.collection_rows)`,
		}),
	})}

	INSERT INTO "metadata"
	SELECT (jsonb_populate_record(original, jsonb_build_object(
		'id', copied.copy_id, 'identifier', copied.copy_id, 'created_by_user_id', copied.user_id
	))).*
	FROM _legacy_custom_media_copies copied
	INNER JOIN "metadata" original ON original.id = copied.original_id;

	${buildCopyLinksSql("metadata_to_genre", "")}
	${buildCopyLinksSql(
		"metadata_to_person",
		`INNER JOIN "person" person ON person.id = link.person_id
	WHERE person.created_by_user_id IS NULL OR person.created_by_user_id = copied.user_id`,
	)}
	${buildCopyLinksSql(
		"metadata_to_metadata_group",
		`INNER JOIN "metadata_group" grp ON grp.id = link.metadata_group_id
	WHERE grp.created_by_user_id IS NULL OR grp.created_by_user_id = copied.user_id`,
	)}

	${buildRepointSql("seen")}
	${buildRepointSql("review")}
	${buildRepointSql("user_to_entity")}
	UPDATE "collection_to_entity" reference
	SET metadata_id = copied.copy_id
	FROM "collection" coll, _legacy_custom_media_copies copied
	WHERE coll.id = reference.collection_id
		AND reference.metadata_id = copied.original_id AND coll.user_id = copied.user_id;
END $$;
`;
