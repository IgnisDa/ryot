import { languageCodeFromName } from "@ryot-app/languages";
import { Effect, Exit, Schema } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

import { insertReportRows } from "./shared";

const phase = "metadata original language -> entity";
const LanguageRow = Schema.Struct({
	language: Schema.String,
	exampleId: Schema.String,
	source: Schema.Literals(["tmdb", "tvdb"]),
});
const LanguageMappings = Schema.fromJsonString(
	Schema.Array(
		Schema.Struct({
			code: Schema.String,
			language: Schema.String,
			source: LanguageRow.fields.source,
		}),
	),
);
const tmdbNames: Readonly<Record<string, string>> = {
	Malay: "ms",
	Greek: "el",
	Khmer: "km",
	Nepali: "ne",
	Punjabi: "pa",
	Swahili: "sw",
	Mandarin: "zh",
	Cantonese: "yue",
	"No Language": "zxx",
};

const migrate = Effect.fn("migrateOriginalLanguages")(function* (
	connection: SqlConnection.Connection,
) {
	const completed = yield* connection
		.execute(
			`SELECT EXISTS (SELECT 1 FROM "migration_report" WHERE phase = $1) AS completed`,
			[phase],
			undefined,
		)
		.pipe(
			Effect.flatMap(
				Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ completed: Schema.Boolean }))),
			),
			Effect.orDie,
		);
	const state = completed[0];
	if (state === undefined) {
		return yield* Effect.die(
			new Error("Original-language migration completion check returned no row"),
		);
	}
	if (state.completed) {
		return yield* Effect.void;
	}
	const rows = yield* connection
		.execute(
			`SELECT legacy.source::text AS source,
      btrim(legacy.original_language) AS language, min(legacy.id::text) AS "exampleId"
    FROM "metadata" legacy JOIN "entity" target ON target.id = legacy.id
    WHERE legacy.source IN ('tmdb', 'tvdb') AND legacy.lot IN ('movie', 'show')
      AND nullif(btrim(legacy.original_language), '') IS NOT NULL
    GROUP BY legacy.source, btrim(legacy.original_language) ORDER BY source, language`,
			[],
			undefined,
		)
		.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(LanguageRow))), Effect.orDie);
	const languages = rows.map(({ source, language, exampleId }) => {
		const code =
			(source === "tmdb" ? tmdbNames[language] : undefined) ?? languageCodeFromName(language);
		if (code === undefined) {
			throw new Error(
				`Legacy ${source} original language "${language}" (metadata ${exampleId}) has no unambiguous language code. Correct the V1 value or report the missing mapping; migration will not guess or discard it.`,
			);
		}
		return { code, source, language };
	});
	const encoded = yield* Schema.encodeEffect(LanguageMappings)(languages).pipe(Effect.orDie);
	const updated = yield* connection
		.execute(
			`WITH changed AS (
    UPDATE "entity" target
    SET properties = target.properties || jsonb_build_object('originalLanguage', mapping.code),
      content_generation = target.content_generation + 1
    FROM "metadata" legacy, jsonb_to_recordset($1::jsonb) AS mapping(source text, language text, code text)
    WHERE target.id = legacy.id AND legacy.source IN ('tmdb', 'tvdb')
      AND legacy.lot IN ('movie', 'show') AND legacy.source::text = mapping.source
      AND btrim(legacy.original_language) = mapping.language
      AND target.properties ->> 'originalLanguage' IS DISTINCT FROM mapping.code RETURNING target.id
  ) SELECT count(*)::int AS count FROM changed`,
			[encoded],
			undefined,
		)
		.pipe(
			Effect.flatMap(
				Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ count: Schema.Int }))),
			),
			Effect.orDie,
		);
	const result = updated[0];
	if (result === undefined) {
		return yield* Effect.die(new Error("Original-language migration returned no update count"));
	}
	return yield* insertReportRows(connection, [
		{
			phase,
			count: result.count,
			elapsedSeconds: null,
			message: "original language value(s) migrated",
		},
	]);
});

export const migrateLegacyOriginalLanguages = Effect.fn("migrateLegacyOriginalLanguages")(
	function* (connection: SqlConnection.Connection) {
		return yield* Effect.acquireUseRelease(
			connection.executeRaw("BEGIN", []),
			() =>
				migrate(connection).pipe(
					Effect.andThen(connection.executeRaw("COMMIT", [])),
					Effect.asVoid,
				),
			(_, exit) =>
				Exit.isFailure(exit)
					? connection.executeRaw("ROLLBACK", []).pipe(Effect.orDie)
					: Effect.void,
		);
	},
);
