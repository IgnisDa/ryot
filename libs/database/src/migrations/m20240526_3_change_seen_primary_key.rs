use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

use super::m20240526_0_change_collection_primary_key::get_whether_column_is_text;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "seen")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub new_id: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if get_whether_column_is_text("seen", "id", db).await? {
            return Ok(());
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "seen" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "seen" SET "new_id" = 'rev_' || "id";
            "#,
        )
        .await?;

        for rev in Entity::find().all(db).await? {
            let new_id = format!("see_{}", nanoid!(12));
            let mut rev: ActiveModel = rev.into();
            rev.new_id = ActiveValue::Set(new_id);
            rev.update(db).await?;
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "seen" DROP CONSTRAINT "seen_pkey";
ALTER TABLE "seen" DROP COLUMN "id";
ALTER TABLE "seen" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "seen" ADD PRIMARY KEY ("id");
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "seen" ALTER COLUMN "id" DROP DEFAULT;
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
-- Step 1: Add temporary columns
ALTER TABLE "seen" ADD COLUMN "temp__progress" numeric DEFAULT 0;
ALTER TABLE "seen" ADD COLUMN "temp__started_on" date;
ALTER TABLE "seen" ADD COLUMN "temp__finished_on" date;
ALTER TABLE "seen" ADD COLUMN "temp__user_id" integer;
ALTER TABLE "seen" ADD COLUMN "temp__metadata_id" integer;
ALTER TABLE "seen" ADD COLUMN "temp__state" text DEFAULT 'IP';
ALTER TABLE "seen" ADD COLUMN "temp__updated_at" timestamp with time zone[] DEFAULT ARRAY[CURRENT_TIMESTAMP];
ALTER TABLE "seen" ADD COLUMN "temp__show_extra_information" jsonb;
ALTER TABLE "seen" ADD COLUMN "temp__podcast_extra_information" jsonb;
ALTER TABLE "seen" ADD COLUMN "temp__anime_extra_information" jsonb;
ALTER TABLE "seen" ADD COLUMN "temp__manga_extra_information" jsonb;
ALTER TABLE "seen" ADD COLUMN "temp__provider_watched_on" text;

-- Step 2: Update temporary columns with the values from original columns
UPDATE "seen" SET
    "temp__progress" = "progress",
    "temp__started_on" = "started_on",
    "temp__finished_on" = "finished_on",
    "temp__user_id" = "user_id",
    "temp__metadata_id" = "metadata_id",
    "temp__state" = "state",
    "temp__updated_at" = "updated_at",
    "temp__show_extra_information" = "show_extra_information",
    "temp__podcast_extra_information" = "podcast_extra_information",
    "temp__anime_extra_information" = "anime_extra_information",
    "temp__manga_extra_information" = "manga_extra_information",
    "temp__provider_watched_on" = "provider_watched_on";

-- Step 3: Set temporary columns to not null if the original columns were not null
ALTER TABLE "seen" ALTER COLUMN "temp__progress" SET NOT NULL;
ALTER TABLE "seen" ALTER COLUMN "temp__user_id" SET NOT NULL;
ALTER TABLE "seen" ALTER COLUMN "temp__metadata_id" SET NOT NULL;
ALTER TABLE "seen" ALTER COLUMN "temp__state" SET NOT NULL;
ALTER TABLE "seen" ALTER COLUMN "temp__updated_at" SET NOT NULL;

-- Step 4: Drop original columns with CASCADE
ALTER TABLE "seen" DROP COLUMN "progress" CASCADE;
ALTER TABLE "seen" DROP COLUMN "started_on" CASCADE;
ALTER TABLE "seen" DROP COLUMN "finished_on" CASCADE;
ALTER TABLE "seen" DROP COLUMN "user_id" CASCADE;
ALTER TABLE "seen" DROP COLUMN "metadata_id" CASCADE;
ALTER TABLE "seen" DROP COLUMN "state" CASCADE;
ALTER TABLE "seen" DROP COLUMN "updated_at" CASCADE;
ALTER TABLE "seen" DROP COLUMN "show_extra_information" CASCADE;
ALTER TABLE "seen" DROP COLUMN "podcast_extra_information" CASCADE;
ALTER TABLE "seen" DROP COLUMN "anime_extra_information" CASCADE;
ALTER TABLE "seen" DROP COLUMN "manga_extra_information" CASCADE;
ALTER TABLE "seen" DROP COLUMN "provider_watched_on" CASCADE;

-- Step 5: Rename temporary columns back to original column names
ALTER TABLE "seen" RENAME COLUMN "temp__progress" TO "progress";
ALTER TABLE "seen" RENAME COLUMN "temp__started_on" TO "started_on";
ALTER TABLE "seen" RENAME COLUMN "temp__finished_on" TO "finished_on";
ALTER TABLE "seen" RENAME COLUMN "temp__user_id" TO "user_id";
ALTER TABLE "seen" RENAME COLUMN "temp__metadata_id" TO "metadata_id";
ALTER TABLE "seen" RENAME COLUMN "temp__state" TO "state";
ALTER TABLE "seen" RENAME COLUMN "temp__updated_at" TO "updated_at";
ALTER TABLE "seen" RENAME COLUMN "temp__show_extra_information" TO "show_extra_information";
ALTER TABLE "seen" RENAME COLUMN "temp__podcast_extra_information" TO "podcast_extra_information";
ALTER TABLE "seen" RENAME COLUMN "temp__anime_extra_information" TO "anime_extra_information";
ALTER TABLE "seen" RENAME COLUMN "temp__manga_extra_information" TO "manga_extra_information";
ALTER TABLE "seen" RENAME COLUMN "temp__provider_watched_on" TO "provider_watched_on";

-- Step 6: Recreate indexes
-- No additional indexes to recreate as the primary key index remains unchanged

-- Step 7: Recreate foreign keys
ALTER TABLE "seen" ADD CONSTRAINT "metadata_to_seen_foreign_key" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "seen" ADD CONSTRAINT "user_to_seen_foreign_key" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;

-- Step 8: Add back generated columns
ALTER TABLE "seen" ADD COLUMN "last_updated_on" timestamp with time zone NOT NULL GENERATED ALWAYS AS (updated_at[array_length(updated_at, 1)]) STORED;
ALTER TABLE "seen" ADD COLUMN "num_times_updated" integer NOT NULL GENERATED ALWAYS AS (array_length(updated_at, 1)) STORED;
ALTER TABLE "seen" ADD COLUMN "total_time_spent" integer GENERATED ALWAYS AS (CASE WHEN array_length(updated_at, 1) < 2 THEN NULL ELSE EXTRACT(EPOCH FROM (updated_at[array_length(updated_at, 1)] - updated_at[1])) END) STORED;
"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
