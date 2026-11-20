import { DatabaseSession } from "@ryot-app/kernel-backend/platform/db/session";
import { PLUGIN_PACKAGE_ID } from "@ryot-app/media-plugin/shared/plugin-identity";
import { sql } from "drizzle-orm";
import { Effect, Layer } from "effect";

export const MoveMediaInventorySettingsLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.execute(sql`
		DO $$
		BEGIN
			IF EXISTS (
				SELECT 1 FROM information_schema.columns
				WHERE table_schema = current_schema()
					AND table_name = 'integration' AND column_name = 'sync_ownership'
			) THEN
				UPDATE "integration" connection
				SET provider_specifics = connection.provider_specifics || jsonb_build_object('syncCopies', connection.sync_ownership),
					client_provider_specifics = connection.client_provider_specifics || jsonb_build_object('syncCopies', connection.sync_ownership)
				FROM "plugin_installation" installation
				JOIN "plugin" owner ON owner.id = installation.plugin_id
				WHERE connection.plugin_installation_id = installation.id
					AND owner.owner_user_id IS NULL
					AND owner.package_id = 'ryot/media'
					AND connection.provider IN ('plex_yank', 'komga', 'audiobookshelf')
					AND NOT (connection.provider_specifics ? 'syncCopies');
			END IF;
		END $$;
	`),
		);
	}),
);

export const MediaCopyCutoverLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db.execute(sql`
		WITH membership AS MATERIALIZED (
			SELECT rel.*
			FROM "relationship" rel
			JOIN "plugin" owner ON owner.id = rel.relationship_schema_plugin_id
			WHERE owner.package_id = ${PLUGIN_PACKAGE_ID}
				AND owner.owner_user_id IS NULL
				AND rel.relationship_schema_slug = 'in-media-library'
				AND rel.user_id IS NOT NULL
				AND rel.properties ?| ARRAY['owned', 'ownedOn', 'ownershipSources', 'ownershipSyncedAt']
		), old_ownership AS (
			UPDATE "relationship" rel
			SET "properties" = rel.properties - ARRAY['owned', 'ownedOn', 'ownershipSources', 'ownershipSyncedAt']
			FROM membership
			WHERE rel.id = membership.id
			RETURNING membership.*
		)
		INSERT INTO "relationship" (
			"id", "key", "user_id", "source_entity_id", "target_entity_id",
			"relationship_schema_slug", "relationship_schema_plugin_id", "created_at", "properties"
		)
		SELECT md5('media-copy:' || id), 'legacy:' || id, user_id, target_entity_id, source_entity_id,
			'media-copy', relationship_schema_plugin_id, created_at,
			jsonb_strip_nulls(jsonb_build_object(
				'origin', 'import',
				'acquiredOn', CASE WHEN jsonb_typeof(properties->'ownedOn') = 'string'
					AND properties->>'ownedOn' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
					AND pg_input_is_valid(properties->>'ownedOn', 'date') THEN properties->'ownedOn' END,
				'legacySources', CASE WHEN jsonb_typeof(properties->'ownershipSources') = 'array' THEN (SELECT jsonb_agg(source) FROM jsonb_array_elements(properties->'ownershipSources') source WHERE jsonb_typeof(source) = 'string') END
			))
		FROM old_ownership
		WHERE properties->'owned' = 'true'::jsonb
	`),
		);
	}),
);
