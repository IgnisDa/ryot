import { isolatedDatabaseLayer } from "@ryot-app/kernel-backend/testing/isolated-database";
import { Effect, Layer } from "effect";
import type * as SqlConnection from "effect/sql/SqlConnection";

import { createLegacyDescriptionInputsSql } from "./description-normalization";
import { buildMetadataMigrationSql, buildPopulatedMetadataIdsSql } from "./metadata-mapping";
import { buildReferencedGlobalEntityIdsSql, withReservedConnection } from "./shared";

export const mediaPluginId = "media";

// The V1 tables the migration phases under test read, reduced to the columns those phases use but
// keeping V1's keys and generated entity columns.
const legacySchemaStatements = [
	`CREATE TABLE "metadata" (
		"id" text PRIMARY KEY, "lot" text NOT NULL, "source" text NOT NULL, "identifier" text NOT NULL,
		"title" text NOT NULL, "description" text, "created_on" timestamptz NOT NULL DEFAULT now(),
		"last_updated_on" timestamptz NOT NULL DEFAULT now(), "publish_year" integer, "publish_date" date,
		"provider_rating" numeric, "production_status" text, "original_language" text, "is_nsfw" boolean,
		"source_url" text, "free_creators" jsonb, "created_by_user_id" text,
		"assets" jsonb NOT NULL DEFAULT '{}', "anime_specifics" jsonb, "audio_book_specifics" jsonb,
		"book_specifics" jsonb, "comic_book_specifics" jsonb, "manga_specifics" jsonb,
		"movie_specifics" jsonb, "music_specifics" jsonb, "podcast_specifics" jsonb,
		"show_specifics" jsonb, "video_game_specifics" jsonb, "visual_novel_specifics" jsonb,
		UNIQUE ("identifier", "source", "lot")
	)`,
	`CREATE TABLE "genre" ("id" text PRIMARY KEY, "name" text NOT NULL)`,
	`CREATE TABLE "metadata_to_genre" (
		"metadata_id" text NOT NULL, "genre_id" text NOT NULL, PRIMARY KEY ("metadata_id", "genre_id")
	)`,
	`CREATE TABLE "person" (
		"id" text PRIMARY KEY, "name" text NOT NULL, "source" text NOT NULL, "identifier" text NOT NULL,
		"created_by_user_id" text
	)`,
	`CREATE TABLE "metadata_to_person" (
		"metadata_id" text NOT NULL, "person_id" text NOT NULL, "role" text NOT NULL, "index" integer,
		"character" text, PRIMARY KEY ("metadata_id", "person_id", "role")
	)`,
	`CREATE TABLE "metadata_group" (
		"id" text PRIMARY KEY, "title" text NOT NULL, "created_by_user_id" text
	)`,
	`CREATE TABLE "metadata_group_to_person" (
		"metadata_group_id" text NOT NULL, "person_id" text NOT NULL, "role" text NOT NULL,
		PRIMARY KEY ("metadata_group_id", "person_id", "role")
	)`,
	`CREATE TABLE "metadata_to_metadata_group" (
		"metadata_id" text NOT NULL, "metadata_group_id" text NOT NULL, "part" integer,
		PRIMARY KEY ("metadata_id", "metadata_group_id")
	)`,
	`CREATE TABLE "seen" (
		"id" text PRIMARY KEY, "user_id" text NOT NULL, "metadata_id" text NOT NULL,
		"state" text NOT NULL DEFAULT 'in_progress', "progress" numeric NOT NULL DEFAULT 0,
		"started_on" timestamptz, "finished_on" timestamptz,
		"updated_at" timestamptz[] NOT NULL DEFAULT ARRAY[CURRENT_TIMESTAMP],
		"manual_time_spent" numeric, "review_id" text, "providers_consumed_on" text[] NOT NULL DEFAULT '{}',
		"show_extra_information" jsonb, "podcast_extra_information" jsonb,
		"anime_extra_information" jsonb, "manga_extra_information" jsonb
	)`,
	`CREATE TABLE "review" (
		"id" text PRIMARY KEY, "user_id" text NOT NULL, "posted_on" timestamptz NOT NULL DEFAULT now(),
		"rating" numeric, "text" text, "is_spoiler" boolean NOT NULL DEFAULT false,
		"show_extra_information" jsonb, "podcast_extra_information" jsonb,
		"anime_extra_information" jsonb, "manga_extra_information" jsonb,
		"metadata_id" text, "person_id" text, "metadata_group_id" text, "collection_id" text,
		"exercise_id" text,
		"entity_id" text GENERATED ALWAYS AS (
			COALESCE("metadata_id", "person_id", "metadata_group_id", "collection_id", "exercise_id")
		) STORED
	)`,
	`CREATE TABLE "user_to_entity" (
		"id" text PRIMARY KEY, "user_id" text NOT NULL, "created_on" timestamptz NOT NULL DEFAULT now(),
		"metadata_id" text, "person_id" text, "metadata_group_id" text, "collection_id" text,
		"exercise_id" text, "exercise_extra_information" jsonb,
		"entity_id" text GENERATED ALWAYS AS (
			COALESCE("exercise_id", "metadata_id", "person_id", "metadata_group_id", "collection_id")
		) STORED,
		UNIQUE ("user_id", "metadata_id")
	)`,
	`CREATE TABLE "collection" (
		"id" text PRIMARY KEY, "user_id" text NOT NULL, "name" text NOT NULL, "description" text,
		"information_template" jsonb, "created_on" timestamptz NOT NULL DEFAULT now(),
		"last_updated_on" timestamptz NOT NULL DEFAULT now()
	)`,
	`CREATE TABLE "collection_to_entity" (
		"id" text PRIMARY KEY, "collection_id" text NOT NULL,
		"created_on" timestamptz NOT NULL DEFAULT now(), "rank" numeric NOT NULL DEFAULT 0,
		"information" jsonb, "metadata_id" text, "person_id" text, "metadata_group_id" text,
		"exercise_id" text, "workout_id" text, "workout_template_id" text,
		"entity_id" text GENERATED ALWAYS AS (
			COALESCE("metadata_id", "person_id", "metadata_group_id", "exercise_id", "workout_id", "workout_template_id")
		) STORED,
		UNIQUE ("collection_id", "metadata_id")
	)`,
	`INSERT INTO "plugin" ("id", "status", "package_id", "activation_id") VALUES ('${mediaPluginId}', 'installed', 'ryot/media', 'media-activation')`,
];

export const legacyDatabaseLayer = (prefix: string) =>
	Layer.effectDiscard(
		withReservedConnection((connection) =>
			Effect.forEach(legacySchemaStatements, (statement) => connection.executeRaw(statement, []), {
				discard: true,
			}),
		),
	).pipe(Layer.provideMerge(isolatedDatabaseLayer(prefix)));

export const insertUsers = (connection: SqlConnection.Connection, ids: ReadonlyArray<string>) =>
	Effect.forEach(
		ids,
		(id) =>
			connection.execute(
				`INSERT INTO "user" ("id", "name", "email") VALUES ($1::text, $1::text, $1::text || '@legacy.test')`,
				[id],
				undefined,
			),
		{ discard: true },
	);

export const migrateLegacyCustomMetadata = (connection: SqlConnection.Connection) =>
	Effect.forEach(
		[
			createLegacyDescriptionInputsSql,
			buildReferencedGlobalEntityIdsSql(),
			buildPopulatedMetadataIdsSql(),
			buildMetadataMigrationSql(
				["book", "movie"].map((lot) => ({
					lot,
					providerId: null,
					source: "custom",
					entitySchemaSlug: lot,
					entitySchemaPluginId: mediaPluginId,
				})),
			),
		],
		(statement) => connection.executeRaw(statement, []),
		{ discard: true },
	);
