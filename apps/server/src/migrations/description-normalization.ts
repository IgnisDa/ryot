import { normalizeAnilistDescription } from "@ryot-app/media-plugin/backend/lib/anilist-description";
import { normalizePlainDescription } from "@ryot-app/media-plugin/backend/lib/plain-description";
import { normalizeRichDescription } from "@ryot-app/media-plugin/backend/lib/rich-description";
import { normalizeVndbDescription } from "@ryot-app/media-plugin/backend/lib/vndb-description";
import { Clock, Effect, Schema } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

import { insertReportRows } from "./shared";

export const createLegacyDescriptionInputsSql = `
CREATE TEMP TABLE _legacy_description_inputs (
	"entityId" text PRIMARY KEY,
	"description" text NOT NULL,
	"source" text NOT NULL,
	"format" text NOT NULL,
	"baseUrl" text
) ON COMMIT PRESERVE ROWS;
`;

export const dropLegacyDescriptionInputsSql = `DROP TABLE IF EXISTS pg_temp._legacy_description_inputs;`;

export const buildCaptureLegacyDescriptionsSql = (sourceSql: string) => `
	INSERT INTO _legacy_description_inputs ("entityId", "description", "source", "format", "baseUrl")
	SELECT "entityId", "description", "source",
		CASE
			WHEN "source" IN ('tmdb', 'tvdb', 'igdb') THEN 'plain'
			WHEN "source" = 'vndb' THEN 'vndb'
			ELSE 'legacy-mixed'
		END,
		"baseUrl"
	FROM (${sourceSql}) inputs
	WHERE "description" IS NOT NULL
	ON CONFLICT ("entityId") DO UPDATE SET
		"description" = EXCLUDED."description",
		"source" = EXCLUDED."source",
		"format" = EXCLUDED."format",
		"baseUrl" = EXCLUDED."baseUrl";
`;

const DescriptionInput = Schema.Struct({
	entityId: Schema.String,
	description: Schema.String,
	baseUrl: Schema.NullOr(Schema.String),
	format: Schema.Literals(["plain", "vndb", "legacy-mixed"]),
	source: Schema.Literals([
		"anilist",
		"audible",
		"custom",
		"giant_bomb",
		"google_books",
		"hardcover",
		"igdb",
		"itunes",
		"listennotes",
		"manga_updates",
		"metron",
		"music_brainz",
		"myanimelist",
		"openlibrary",
		"spotify",
		"tmdb",
		"tvdb",
		"vndb",
		"youtube_music",
	]),
});

const decodeInputs = Schema.decodeUnknownEffect(Schema.Array(DescriptionInput));
const decodeUpdated = Schema.decodeUnknownEffect(
	Schema.Array(Schema.Struct({ id: Schema.String })),
);
const encodePatches = Schema.encodeSync(
	Schema.fromJsonString(
		Schema.Array(
			Schema.Struct({ entityId: Schema.String, description: Schema.NullOr(Schema.String) }),
		),
	),
);
const batchSize = 250;

const normalizeDescription = Effect.fn("normalizeLegacyDescription")(function* (
	input: typeof DescriptionInput.Type,
) {
	if (input.source === "anilist") {
		return yield* normalizeAnilistDescription(input.description, input.baseUrl ?? undefined);
	}
	switch (input.format) {
		case "plain":
			return normalizePlainDescription(input.description);
		case "vndb":
			return yield* normalizeVndbDescription(input.description, input.baseUrl ?? undefined);
		case "legacy-mixed":
			return yield* normalizeRichDescription(input.description, input.baseUrl ?? undefined);
		default:
			return yield* Effect.die(new Error("Unsupported legacy description format"));
	}
});

export const normalizeLegacyDescriptions = Effect.fn("normalizeLegacyDescriptions")(function* (
	connection: SqlConnection.Connection,
) {
	const startedAt = yield* Clock.currentTimeMillis;
	const counts = new Map<string, number>();
	let cursor: string | null = null;
	for (;;) {
		const inputs = yield* connection
			.execute(
				`SELECT * FROM _legacy_description_inputs
			WHERE $1::text IS NULL OR "entityId" > $1
			ORDER BY "entityId" LIMIT $2`,
				[cursor, batchSize],
				undefined,
			)
			.pipe(Effect.flatMap(decodeInputs), Effect.orDie);
		if (inputs.length === 0) {
			break;
		}
		const patches = yield* Effect.forEach(inputs, (input) =>
			normalizeDescription(input).pipe(
				Effect.map((description) => ({ description, entityId: input.entityId })),
				Effect.mapError(
					(error) =>
						new Error(
							`Legacy description conversion failed for ${input.entityId} (${input.source}/${input.format}): ${String(error)}. Keep the dump and report a migration defect.`,
						),
				),
				Effect.orDie,
			),
		);
		const updated = yield* connection
			.execute(
				`UPDATE "entity" entity
			SET "properties" = jsonb_set(entity."properties", '{description}', COALESCE(to_jsonb(patch.description), 'null'::jsonb))
			FROM jsonb_to_recordset($1::jsonb) AS patch("entityId" text, description text)
			WHERE entity.id = patch."entityId" AND entity."properties" ? 'description'
			RETURNING entity.id`,
				[encodePatches(patches)],
				undefined,
			)
			.pipe(Effect.flatMap(decodeUpdated), Effect.orDie);
		if (updated.length !== inputs.length) {
			return yield* Effect.die(
				new Error(
					`Legacy descriptions: expected ${inputs.length} targets, updated ${updated.length}; staged sample: ${inputs
						.slice(0, 20)
						.map((input) => input.entityId)
						.join(
							", ",
						)}. Missing copied descriptions block migration. Keep the dump and report a migration defect.`,
				),
			);
		}
		for (const input of inputs) {
			const key = `${input.source}/${input.format}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
			cursor = input.entityId;
		}
	}
	const elapsedSeconds = ((yield* Clock.currentTimeMillis) - startedAt) / 1000;
	yield* insertReportRows(connection, [
		{
			elapsedSeconds,
			phase: "legacy descriptions -> Markdown",
			message: "description(s) normalized total",
			count: [...counts.values()].reduce((total, count) => total + count, 0),
		},
		...[...counts].map(([source, count]) => ({
			count,
			elapsedSeconds,
			phase: "legacy descriptions -> Markdown",
			message: `${source} description(s) normalized`,
		})),
	]);
	return yield* Effect.void;
});
