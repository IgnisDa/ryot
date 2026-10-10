import { JsonValue } from "@ryot-app/contract/schema/json";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { DatabaseSession } from "@ryot-app/kernel-backend/lib/infrastructure/db/session";
import { formatPropertyIssues } from "@ryot-app/kernel-backend/lib/property-schema/property-schema-runtime";
import { resolvePluginUserSettings } from "@ryot-app/kernel-backend/modules/plugins/user-settings";
import { sql } from "drizzle-orm";
import { Clock, Effect, Schema } from "effect";

const phase = "old_user -> plugin user settings";

const LegacySettingsRow = Schema.Struct({
	userId: Schema.String,
	validFitnessStructure: Schema.Boolean,
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
			const writes: Array<{
				userId: string;
				pluginId: string;
				installationId: string;
				settings: Schema.Schema.Type<typeof LegacySettingsRow>["fitnessSettings"];
			}> = [];
			for (const row of legacySettings) {
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
						settings: row.mediaSettings,
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
