import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { formatPropertyIssues } from "@ryot-app/kernel-backend/modules/definitions/properties/runtime";
import { resolvePluginUserSettings } from "@ryot-app/kernel-backend/modules/plugins/preferences/user-settings";
import { DatabaseSession } from "@ryot-app/kernel-backend/platform/db/session";
import { sql } from "drizzle-orm";
import { Clock, Effect, Schema } from "effect";

const phase = "old_user -> plugin user settings";

const WATCH_PROVIDER_VALUE_LIMIT = 100;
const WATCH_PROVIDER_LIST_LIMIT = 30;

const watchProviderSettingKeys: Readonly<Record<string, string>> = {
	book: "consumedOnBook",
	show: "consumedOnShow",
	anime: "consumedOnAnime",
	movie: "consumedOnMovie",
	manga: "consumedOnManga",
	music: "consumedOnMusic",
	podcast: "consumedOnPodcast",
	audio_book: "consumedOnAudiobook",
	video_game: "consumedOnVideoGame",
	comic_book: "consumedOnComicBook",
	visual_novel: "consumedOnVisualNovel",
};

const LegacyWatchProviders = Schema.Array(
	Schema.Struct({ lot: Schema.String, values: Schema.Array(Schema.String) }),
);

const watchProviderOmissionMessages = {
	empty: "empty or blank V1 watch provider value(s) omitted from consumed-on lists",
	duplicate: "case-insensitive duplicate V1 watch provider value(s) omitted from consumed-on lists",
	tooLong: `V1 watch provider value(s) over ${WATCH_PROVIDER_VALUE_LIMIT} characters omitted from consumed-on lists`,
	overLimit: `V1 watch provider value(s) past the ${WATCH_PROVIDER_LIST_LIMIT}th in a lot omitted from consumed-on lists`,
} as const;

type WatchProviderOmissions = Record<keyof typeof watchProviderOmissionMessages, number>;

const mapWatchProviders = (userId: string, raw: unknown, omissions: WatchProviderOmissions) => {
	const lists = new Map<string, string[]>();
	if (raw === null) {
		return lists;
	}
	const decoded = Schema.decodeUnknownOption(LegacyWatchProviders)(raw);
	if (decoded._tag === "None") {
		throw new Error(
			`Legacy bootstrap: watch providers for user ${userId} are not a list of {lot, values} entries with text values. Mapping them would discard the stored choices. Correct preferences.general.watch_providers in the V1 database, then start again.`,
		);
	}
	for (const { lot, values } of decoded.value) {
		const key = Object.hasOwn(watchProviderSettingKeys, lot)
			? watchProviderSettingKeys[lot]
			: undefined;
		if (key === undefined) {
			throw new Error(
				`Legacy bootstrap: watch providers for user ${userId} name the unknown lot "${lot}". Mapping them would discard the stored choices. Remove or correct that entry in preferences.general.watch_providers in the V1 database, then start again.`,
			);
		}
		const list = lists.get(key) ?? [];
		lists.set(key, list);
		for (const value of values) {
			const trimmed = value.trim();
			if (trimmed === "") {
				omissions.empty += 1;
			} else if (trimmed.length > WATCH_PROVIDER_VALUE_LIMIT) {
				omissions.tooLong += 1;
			} else if (list.some((kept) => kept.toLowerCase() === trimmed.toLowerCase())) {
				omissions.duplicate += 1;
			} else if (list.length >= WATCH_PROVIDER_LIST_LIMIT) {
				omissions.overLimit += 1;
			} else {
				list.push(trimmed);
			}
		}
	}
	return lists;
};

const LegacySettingsRow = Schema.Struct({
	userId: Schema.String,
	validFitnessStructure: Schema.Boolean,
	watchProviders: Schema.NullOr(JsonValue),
	mediaSettings: Schema.Record(Schema.String, JsonValue),
	fitnessSettings: Schema.Record(Schema.String, JsonValue),
});

const legacySettingsSql = sql`
	SELECT id AS "userId",
		jsonb_typeof(preferences) IS NOT DISTINCT FROM 'object' AND NOT EXISTS (
			SELECT 1 FROM (VALUES
				(ARRAY['fitness']),
				(ARRAY['fitness', 'exercises']),
				(ARRAY['fitness', 'logging']),
				(ARRAY['fitness', 'exercises', 'set_rest_timers'])
			) preference_block(path)
			WHERE preferences #> preference_block.path IS NOT NULL
				AND jsonb_typeof(preferences #> preference_block.path) <> 'object'
		) AS "validFitnessStructure",
		preferences #> '{general,watch_providers}' AS "watchProviders",
		jsonb_build_object(
			'allowNsfw', COALESCE((preferences #>> '{general,display_nsfw}')::boolean, true)
		) AS "mediaSettings",
		jsonb_build_object(
			'unitSystem', CASE
				WHEN preferences #> '{fitness,exercises,unit_system}' IS NULL THEN 'metric'
				ELSE lower(btrim(preferences #>> '{fitness,exercises,unit_system}'))
			END,
			'normalRestTime', CASE
				WHEN preferences #> '{fitness,exercises,set_rest_timers}' IS NULL THEN '60'::jsonb
				ELSE COALESCE(NULLIF(preferences #> '{fitness,exercises,set_rest_timers,normal}', 'null'::jsonb), '0'::jsonb)
			END,
			'warmUpRestTime', COALESCE(NULLIF(preferences #> '{fitness,exercises,set_rest_timers,warmup}', 'null'::jsonb), '0'::jsonb),
			'dropRestTime', COALESCE(NULLIF(preferences #> '{fitness,exercises,set_rest_timers,drop}', 'null'::jsonb), '0'::jsonb),
			'failureRestTime', COALESCE(NULLIF(preferences #> '{fitness,exercises,set_rest_timers,failure}', 'null'::jsonb), '0'::jsonb),
			'muteSounds', COALESCE(preferences #> '{fitness,logging,mute_sounds}', 'false'::jsonb),
			'promptForRestTimer', COALESCE(preferences #> '{fitness,logging,prompt_for_rest_timer}', 'false'::jsonb),
			'startTimerForDurationExercises', COALESCE(preferences #> '{fitness,logging,start_timer_for_duration_exercises}', 'true'::jsonb),
			'energyUnit', CASE
				WHEN preferences #> '{fitness,logging,calories_burnt_unit}' IS NULL THEN 'kcal'
				WHEN lower(btrim(preferences #>> '{fitness,logging,calories_burnt_unit}')) = 'kj' THEN 'kJ'
				ELSE lower(btrim(preferences #>> '{fitness,logging,calories_burnt_unit}'))
			END
		) AS "fitnessSettings"
	FROM "old_user"
	ORDER BY id
`;

export const migrateLegacyUserSettings = Effect.fn("migrateLegacyUserSettings")(function* (input: {
	mediaPluginId: string;
	fitnessPluginId: string;
	mediaSettingsSchema: AppSchema;
	fitnessSettingsSchema: AppSchema;
	installations: ReadonlyArray<{
		userId: string;
		mediaInstallationId: string;
		fitnessInstallationId: string;
	}>;
}) {
	const session = yield* DatabaseSession;
	yield* session.transaction(
		Effect.gen(function* () {
			const completed = yield* session.run((database) =>
				database.execute<{ present: boolean }>(
					sql`SELECT EXISTS (SELECT 1 FROM "migration_report" WHERE phase = ${phase}) AS present`,
					"objects",
				),
			);
			const completion = completed[0];
			if (!completion) {
				throw new Error(
					"Legacy bootstrap: the preference phase completion check returned no row. Keep the dump and report this migration defect.",
				);
			}
			if (completion.present) {
				return;
			}
			const startedAt = yield* Clock.currentTimeMillis;
			const rows = yield* session.run((database) => database.execute(legacySettingsSql, "objects"));
			const legacySettings = yield* Schema.decodeUnknownEffect(Schema.Array(LegacySettingsRow))(
				rows,
			).pipe(Effect.orDie);
			if (legacySettings.length !== input.installations.length) {
				throw new Error(
					`Legacy bootstrap: expected ${input.installations.length} legacy preference records, found ${legacySettings.length}. Preferences cannot be attributed safely. Keep the dump and report this migration defect.`,
				);
			}
			const targets = new Map(input.installations.map((row) => [row.userId, row]));
			const omissions: WatchProviderOmissions = {
				empty: 0,
				tooLong: 0,
				duplicate: 0,
				overLimit: 0,
			};
			const writes: Array<{
				userId: string;
				pluginId: string;
				installationId: string;
				settings: Schema.Schema.Type<typeof LegacySettingsRow>["fitnessSettings"];
			}> = [];
			for (const row of legacySettings) {
				const mediaSettings = {
					...row.mediaSettings,
					...Object.fromEntries(mapWatchProviders(row.userId, row.watchProviders, omissions)),
				};
				if (!row.validFitnessStructure) {
					throw new Error(
						`Legacy bootstrap: Fitness preferences for user ${row.userId} contain a non-object preference block. Mapping it would discard the stored choices. Correct the fitness preference blocks in the V1 database, then start again.`,
					);
				}
				const target = targets.get(row.userId);
				if (!target) {
					throw new Error(
						`Legacy bootstrap: user ${row.userId} has no exact preference installation mapping. Keep the dump and report this migration defect.`,
					);
				}
				for (const plugin of [
					{
						name: "Media",
						settings: mediaSettings,
						pluginId: input.mediaPluginId,
						schema: input.mediaSettingsSchema,
						installationId: target.mediaInstallationId,
					},
					{
						name: "Fitness",
						settings: row.fitnessSettings,
						pluginId: input.fitnessPluginId,
						schema: input.fitnessSettingsSchema,
						installationId: target.fitnessInstallationId,
					},
				]) {
					const settings = yield* resolvePluginUserSettings(plugin.schema, plugin.settings).pipe(
						Effect.catchTag("PropertyValidationError", (error) =>
							Effect.die(
								new Error(
									`Legacy bootstrap: ${plugin.name} preferences for user ${row.userId} failed active settings validation: ${formatPropertyIssues(error.issues)}. Correct these preferences in the V1 database, or use a build with the supported settings schema, then start again.`,
								),
							),
						),
					);
					writes.push({
						settings,
						userId: row.userId,
						pluginId: plugin.pluginId,
						installationId: plugin.installationId,
					});
				}
			}
			for (let offset = 0; offset < writes.length; offset += 500) {
				const batch = writes.slice(offset, offset + 500);
				const updated = yield* session.run((database) =>
					database.execute(
						sql`
					UPDATE "plugin_installation" installation
					SET user_settings = target.settings
					FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
						AS target("userId" text, "pluginId" text, "installationId" text, settings jsonb)
					WHERE installation.id = target."installationId"
						AND installation.user_id = target."userId"
						AND installation.plugin_id = target."pluginId"
					RETURNING installation.id
				`,
						"objects",
					),
				);
				if (updated.length !== batch.length) {
					throw new Error(
						`Legacy bootstrap: expected ${batch.length} exact Media/Fitness installations for user settings, found ${updated.length}. Preferences cannot be attributed safely. Keep the dump and report this migration defect.`,
					);
				}
			}
			for (const kind of ["empty", "duplicate", "tooLong", "overLimit"] as const) {
				const count = omissions[kind];
				const message = watchProviderOmissionMessages[kind];
				if (count > 0) {
					yield* session.run((database) =>
						database.execute(
							sql`
				INSERT INTO "migration_report" (phase, level, message, count)
				VALUES (${phase}, 'warning', ${message}, ${count})
			`,
							"objects",
						),
					);
				}
			}
			const elapsedSeconds = Math.round(((yield* Clock.currentTimeMillis) - startedAt) / 100) / 10;
			yield* session.run((database) =>
				database.execute(
					sql`
				INSERT INTO "migration_report" (phase, level, message, count, elapsed_seconds)
				VALUES (${phase}, 'info', 'user preference record(s) migrated', ${writes.length}, ${elapsedSeconds})
			`,
					"objects",
				),
			);
		}),
	);
});
