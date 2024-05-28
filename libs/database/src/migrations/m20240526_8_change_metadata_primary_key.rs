use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

use super::get_whether_column_is_text;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "metadata")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub temp_id: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if get_whether_column_is_text("metadata", "id", db).await? {
            return Ok(());
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "metadata" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "metadata" SET "new_id" = 'met_' || "id";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "calendar_event" ADD COLUMN "new_metadata_id" text;
ALTER TABLE "collection_to_entity" ADD COLUMN "new_metadata_id" text;
ALTER TABLE "metadata_to_genre" ADD COLUMN "new_metadata_id" text;
ALTER TABLE "metadata_to_metadata" ADD COLUMN "new_from_metadata_id" text;
ALTER TABLE "metadata_to_metadata" ADD COLUMN "new_to_metadata_id" text;
ALTER TABLE "metadata_to_metadata_group" ADD COLUMN "new_metadata_id" text;
ALTER TABLE "metadata_to_person" ADD COLUMN "new_metadata_id" text;
ALTER TABLE "review" ADD COLUMN "new_metadata_id" text;
ALTER TABLE "seen" ADD COLUMN "new_metadata_id" text;
ALTER TABLE "user_to_entity" ADD COLUMN "new_metadata_id" text;

UPDATE "calendar_event" SET "new_metadata_id" = 'met_' || "metadata_id";
UPDATE "collection_to_entity" SET "new_metadata_id" = 'met_' || "metadata_id";
UPDATE "metadata_to_genre" SET "new_metadata_id" = 'met_' || "metadata_id";
UPDATE "metadata_to_metadata" SET "new_from_metadata_id" = 'met_' || "from_metadata_id";
UPDATE "metadata_to_metadata" SET "new_to_metadata_id" = 'met_' || "to_metadata_id";
UPDATE "metadata_to_metadata_group" SET "new_metadata_id" = 'met_' || "metadata_id";
UPDATE "metadata_to_person" SET "new_metadata_id" = 'met_' || "metadata_id";
UPDATE "review" SET "new_metadata_id" = 'met_' || "metadata_id";
UPDATE "seen" SET "new_metadata_id" = 'met_' || "metadata_id";
UPDATE "user_to_entity" SET "new_metadata_id" = 'met_' || "metadata_id";

ALTER TABLE "calendar_event" DROP CONSTRAINT "fk-calendar_event_to_metadata";
ALTER TABLE "collection_to_entity" DROP CONSTRAINT "collection_to_entity-fk2";
ALTER TABLE "metadata_to_genre" DROP CONSTRAINT "fk-metadata_id-genre_id";
ALTER TABLE "metadata_to_metadata" DROP CONSTRAINT "metadata_to_metadata_from_metadata_id_fkey";
ALTER TABLE "metadata_to_metadata" DROP CONSTRAINT "metadata_to_metadata_to_metadata_id_fkey";
ALTER TABLE "metadata_to_metadata_group" DROP CONSTRAINT "metadata_to_metadata_group_metadata_id_fkey";
ALTER TABLE "metadata_to_person" DROP CONSTRAINT "fk-media-item_media-person_id";
ALTER TABLE "review" DROP CONSTRAINT "review_to_metadata_foreign_key";
ALTER TABLE "seen" DROP CONSTRAINT "metadata_to_seen_foreign_key";
ALTER TABLE "user_to_entity" DROP CONSTRAINT "user_to_entity-fk2";

ALTER TABLE "metadata" DROP CONSTRAINT "metadata_pkey";
ALTER TABLE "metadata" DROP COLUMN "id";
ALTER TABLE "metadata" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "metadata" ADD PRIMARY KEY ("id");

ALTER TABLE "metadata" ADD COLUMN "temp_id" text;
UPDATE "metadata" SET "temp_id" = "id";

ALTER TABLE "calendar_event" DROP COLUMN "metadata_id";
ALTER TABLE "calendar_event" RENAME COLUMN "new_metadata_id" TO "metadata_id";

ALTER TABLE "collection_to_entity" DROP COLUMN "metadata_id";
ALTER TABLE "collection_to_entity" RENAME COLUMN "new_metadata_id" TO "metadata_id";

ALTER TABLE "metadata_to_genre" DROP COLUMN "metadata_id";
ALTER TABLE "metadata_to_genre" RENAME COLUMN "new_metadata_id" TO "metadata_id";

ALTER TABLE "metadata_to_metadata" DROP COLUMN "from_metadata_id";
ALTER TABLE "metadata_to_metadata" RENAME COLUMN "new_from_metadata_id" TO "from_metadata_id";

ALTER TABLE "metadata_to_metadata" DROP COLUMN "to_metadata_id";
ALTER TABLE "metadata_to_metadata" RENAME COLUMN "new_to_metadata_id" TO "to_metadata_id";

ALTER TABLE "metadata_to_metadata_group" DROP COLUMN "metadata_id";
ALTER TABLE "metadata_to_metadata_group" RENAME COLUMN "new_metadata_id" TO "metadata_id";

ALTER TABLE "metadata_to_person" DROP COLUMN "metadata_id";
ALTER TABLE "metadata_to_person" RENAME COLUMN "new_metadata_id" TO "metadata_id";

ALTER TABLE "review" DROP COLUMN "metadata_id";
ALTER TABLE "review" RENAME COLUMN "new_metadata_id" TO "metadata_id";

ALTER TABLE "seen" DROP COLUMN "metadata_id";
ALTER TABLE "seen" RENAME COLUMN "new_metadata_id" TO "metadata_id";

ALTER TABLE "user_to_entity" DROP COLUMN "metadata_id";
ALTER TABLE "user_to_entity" RENAME COLUMN "new_metadata_id" TO "metadata_id";

ALTER TABLE "calendar_event" ADD CONSTRAINT "fk-calendar_event_to_metadata" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "collection_to_entity" ADD CONSTRAINT "collection_to_entity-fk2" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "metadata_to_genre" ADD CONSTRAINT "fk-metadata_id-genre_id" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "metadata_to_metadata" ADD CONSTRAINT "metadata_to_metadata_from_metadata_id_fkey" FOREIGN KEY ("from_metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "metadata_to_metadata" ADD CONSTRAINT "metadata_to_metadata_to_metadata_id_fkey" FOREIGN KEY ("to_metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "metadata_to_metadata_group" ADD CONSTRAINT "metadata_to_metadata_group_metadata_id_fkey" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "metadata_to_person" ADD CONSTRAINT "fk-media-item_media-person_id" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_to_metadata_foreign_key" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "seen" ADD CONSTRAINT "metadata_to_seen_foreign_key" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "user_to_entity" ADD CONSTRAINT "user_to_entity-fk2" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;

CREATE UNIQUE INDEX "metadata_to_metadata_from_metadata_id_relation_to_metadata__idx" ON "metadata_to_metadata" ("from_metadata_id", "to_metadata_id");
CREATE UNIQUE INDEX "user_to_entity-uqi1" ON "user_to_entity" ("user_id", "metadata_id");
            "#,
        )
        .await?;

        for metadata in Entity::find().all(db).await? {
            let new_id = format!("met_{}", nanoid!(12));
            let mut metadata: ActiveModel = metadata.into();
            metadata.temp_id = ActiveValue::Set(new_id);
            metadata.update(db).await?;
        }
        db.execute_unprepared(r#"UPDATE "metadata" SET "id" = "temp_id""#)
            .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "calendar_event"
ALTER COLUMN "metadata_id" SET NOT NULL;
ALTER TABLE "collection_to_entity"
ALTER COLUMN "metadata_id" SET NOT NULL;
ALTER TABLE "metadata_to_genre"
ALTER COLUMN "metadata_id" SET NOT NULL;
ALTER TABLE "metadata_to_metadata"
ALTER COLUMN "from_metadata_id" SET NOT NULL;
ALTER TABLE "metadata_to_metadata"
ALTER COLUMN "to_metadata_id" SET NOT NULL;
ALTER TABLE "metadata_to_metadata_group"
ALTER COLUMN "metadata_id" SET NOT NULL;
ALTER TABLE "metadata_to_person"
ALTER COLUMN "metadata_id" SET NOT NULL;
ALTER TABLE "review"
ALTER COLUMN "metadata_id" SET NOT NULL;
ALTER TABLE "seen"
ALTER COLUMN "metadata_id" SET NOT NULL;
ALTER TABLE "user_to_entity"
ALTER COLUMN "metadata_id" SET NOT NULL;
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "metadata" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "metadata" DROP COLUMN "temp_id";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
-- Step 1: Add temporary columns
ALTER TABLE "metadata" ADD COLUMN "temp__identifier" text;
ALTER TABLE "metadata" ADD COLUMN "temp__source" text;
ALTER TABLE "metadata" ADD COLUMN "temp__created_on" timestamp with time zone DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "metadata" ADD COLUMN "temp__last_updated_on" timestamp with time zone DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "metadata" ADD COLUMN "temp__title" text;
ALTER TABLE "metadata" ADD COLUMN "temp__description" text;
ALTER TABLE "metadata" ADD COLUMN "temp__publish_year" integer;
ALTER TABLE "metadata" ADD COLUMN "temp__publish_date" date;
ALTER TABLE "metadata" ADD COLUMN "temp__provider_rating" numeric;
ALTER TABLE "metadata" ADD COLUMN "temp__is_nsfw" boolean;
ALTER TABLE "metadata" ADD COLUMN "temp__images" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__videos" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__free_creators" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__original_language" text;
ALTER TABLE "metadata" ADD COLUMN "temp__is_partial" boolean;
ALTER TABLE "metadata" ADD COLUMN "temp__audio_book_specifics" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__anime_specifics" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__book_specifics" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__podcast_specifics" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__manga_specifics" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__movie_specifics" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__show_specifics" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__video_game_specifics" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__visual_novel_specifics" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__watch_providers" jsonb;
ALTER TABLE "metadata" ADD COLUMN "temp__state_changes" jsonb;

-- Step 2: Update temporary columns with the values from original columns
UPDATE "metadata" SET
    "temp__identifier" = "identifier",
    "temp__source" = "source",
    "temp__created_on" = "created_on",
    "temp__last_updated_on" = "last_updated_on",
    "temp__title" = "title",
    "temp__description" = "description",
    "temp__publish_year" = "publish_year",
    "temp__publish_date" = "publish_date",
    "temp__provider_rating" = "provider_rating",
    "temp__is_nsfw" = "is_nsfw",
    "temp__images" = "images",
    "temp__videos" = "videos",
    "temp__free_creators" = "free_creators",
    "temp__original_language" = "original_language",
    "temp__is_partial" = "is_partial",
    "temp__audio_book_specifics" = "audio_book_specifics",
    "temp__anime_specifics" = "anime_specifics",
    "temp__book_specifics" = "book_specifics",
    "temp__podcast_specifics" = "podcast_specifics",
    "temp__manga_specifics" = "manga_specifics",
    "temp__movie_specifics" = "movie_specifics",
    "temp__show_specifics" = "show_specifics",
    "temp__video_game_specifics" = "video_game_specifics",
    "temp__visual_novel_specifics" = "visual_novel_specifics",
    "temp__watch_providers" = "watch_providers",
    "temp__state_changes" = "state_changes";

-- Step 3: Set temporary columns to not null if the original columns were not null
ALTER TABLE "metadata" ALTER COLUMN "temp__identifier" SET NOT NULL;
ALTER TABLE "metadata" ALTER COLUMN "temp__source" SET NOT NULL;
ALTER TABLE "metadata" ALTER COLUMN "temp__created_on" SET NOT NULL;
ALTER TABLE "metadata" ALTER COLUMN "temp__last_updated_on" SET NOT NULL;
ALTER TABLE "metadata" ALTER COLUMN "temp__title" SET NOT NULL;

-- Step 4: Drop original columns with CASCADE
ALTER TABLE "metadata" DROP COLUMN "identifier" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "source" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "created_on" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "last_updated_on" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "title" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "description" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "publish_year" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "publish_date" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "provider_rating" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "is_nsfw" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "images" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "videos" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "free_creators" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "original_language" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "is_partial" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "audio_book_specifics" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "anime_specifics" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "book_specifics" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "podcast_specifics" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "manga_specifics" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "movie_specifics" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "show_specifics" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "video_game_specifics" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "visual_novel_specifics" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "watch_providers" CASCADE;
ALTER TABLE "metadata" DROP COLUMN "state_changes" CASCADE;

-- Step 5: Rename temporary columns back to original column names
ALTER TABLE "metadata" RENAME COLUMN "temp__identifier" TO "identifier";
ALTER TABLE "metadata" RENAME COLUMN "temp__source" TO "source";
ALTER TABLE "metadata" RENAME COLUMN "temp__created_on" TO "created_on";
ALTER TABLE "metadata" RENAME COLUMN "temp__last_updated_on" TO "last_updated_on";
ALTER TABLE "metadata" RENAME COLUMN "temp__title" TO "title";
ALTER TABLE "metadata" RENAME COLUMN "temp__description" TO "description";
ALTER TABLE "metadata" RENAME COLUMN "temp__publish_year" TO "publish_year";
ALTER TABLE "metadata" RENAME COLUMN "temp__publish_date" TO "publish_date";
ALTER TABLE "metadata" RENAME COLUMN "temp__provider_rating" TO "provider_rating";
ALTER TABLE "metadata" RENAME COLUMN "temp__is_nsfw" TO "is_nsfw";
ALTER TABLE "metadata" RENAME COLUMN "temp__images" TO "images";
ALTER TABLE "metadata" RENAME COLUMN "temp__videos" TO "videos";
ALTER TABLE "metadata" RENAME COLUMN "temp__free_creators" TO "free_creators";
ALTER TABLE "metadata" RENAME COLUMN "temp__original_language" TO "original_language";
ALTER TABLE "metadata" RENAME COLUMN "temp__is_partial" TO "is_partial";
ALTER TABLE "metadata" RENAME COLUMN "temp__audio_book_specifics" TO "audio_book_specifics";
ALTER TABLE "metadata" RENAME COLUMN "temp__anime_specifics" TO "anime_specifics";
ALTER TABLE "metadata" RENAME COLUMN "temp__book_specifics" TO "book_specifics";
ALTER TABLE "metadata" RENAME COLUMN "temp__podcast_specifics" TO "podcast_specifics";
ALTER TABLE "metadata" RENAME COLUMN "temp__manga_specifics" TO "manga_specifics";
ALTER TABLE "metadata" RENAME COLUMN "temp__movie_specifics" TO "movie_specifics";
ALTER TABLE "metadata" RENAME COLUMN "temp__show_specifics" TO "show_specifics";
ALTER TABLE "metadata" RENAME COLUMN "temp__video_game_specifics" TO "video_game_specifics";
ALTER TABLE "metadata" RENAME COLUMN "temp__visual_novel_specifics" TO "visual_novel_specifics";
ALTER TABLE "metadata" RENAME COLUMN "temp__watch_providers" TO "watch_providers";
ALTER TABLE "metadata" RENAME COLUMN "temp__state_changes" TO "state_changes";

-- Step 6: Recreate indexes
CREATE UNIQUE INDEX "metadata-identifier-source-lot__unique-index" ON "metadata" ("identifier", "source", "lot");
            "#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
