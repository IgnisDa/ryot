use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

use super::get_whether_column_is_text;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "review")]
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
        if get_whether_column_is_text("review", "id", db).await? {
            return Ok(());
        }

        tracing::warn!("Starting to change review primary key to text");
        db.execute_unprepared(
            r#"
ALTER TABLE "review" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "review" SET "new_id" = 'rev_' || "id";
            "#,
        )
        .await?;

        for rev in Entity::find().all(db).await? {
            let new_id = format!("rev_{}", nanoid!(12));
            let mut rev: ActiveModel = rev.into();
            rev.new_id = ActiveValue::Set(new_id);
            rev.update(db).await?;
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "review" DROP CONSTRAINT "review_pkey";
ALTER TABLE "review" DROP COLUMN "id";
ALTER TABLE "review" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "review" ADD PRIMARY KEY ("id");
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "review" ALTER COLUMN "id" DROP DEFAULT;
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
-- Step 1: Add temporary columns
ALTER TABLE "review" ADD COLUMN "temp__posted_on" timestamp with time zone DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "review" ADD COLUMN "temp__rating" numeric;
ALTER TABLE "review" ADD COLUMN "temp__text" text;
ALTER TABLE "review" ADD COLUMN "temp__spoiler" boolean DEFAULT false;
ALTER TABLE "review" ADD COLUMN "temp__visibility" text DEFAULT 'PR';
ALTER TABLE "review" ADD COLUMN "temp__user_id" integer;
ALTER TABLE "review" ADD COLUMN "temp__metadata_id" integer;
ALTER TABLE "review" ADD COLUMN "temp__person_id" integer;
ALTER TABLE "review" ADD COLUMN "temp__metadata_group_id" integer;
ALTER TABLE "review" ADD COLUMN "temp__comments" jsonb;
ALTER TABLE "review" ADD COLUMN "temp__show_extra_information" jsonb;
ALTER TABLE "review" ADD COLUMN "temp__podcast_extra_information" jsonb;
ALTER TABLE "review" ADD COLUMN "temp__anime_extra_information" jsonb;
ALTER TABLE "review" ADD COLUMN "temp__manga_extra_information" jsonb;
ALTER TABLE "review" ADD COLUMN "temp__collection_id" text;

-- Step 2: Update temporary columns with the values from original columns
UPDATE "review" SET
    "temp__posted_on" = "posted_on",
    "temp__rating" = "rating",
    "temp__text" = "text",
    "temp__spoiler" = "spoiler",
    "temp__visibility" = "visibility",
    "temp__user_id" = "user_id",
    "temp__metadata_id" = "metadata_id",
    "temp__person_id" = "person_id",
    "temp__metadata_group_id" = "metadata_group_id",
    "temp__comments" = "comments",
    "temp__show_extra_information" = "show_extra_information",
    "temp__podcast_extra_information" = "podcast_extra_information",
    "temp__anime_extra_information" = "anime_extra_information",
    "temp__manga_extra_information" = "manga_extra_information",
    "temp__collection_id" = "collection_id";

-- Step 3: Set temporary columns to not null if the original columns were not null
ALTER TABLE "review" ALTER COLUMN "temp__posted_on" SET NOT NULL;
ALTER TABLE "review" ALTER COLUMN "temp__spoiler" SET NOT NULL;
ALTER TABLE "review" ALTER COLUMN "temp__visibility" SET NOT NULL;
ALTER TABLE "review" ALTER COLUMN "temp__user_id" SET NOT NULL;
ALTER TABLE "review" ALTER COLUMN "temp__comments" SET NOT NULL;

-- Step 4: Drop original columns with CASCADE
ALTER TABLE "review" DROP COLUMN "posted_on" CASCADE;
ALTER TABLE "review" DROP COLUMN "rating" CASCADE;
ALTER TABLE "review" DROP COLUMN "text" CASCADE;
ALTER TABLE "review" DROP COLUMN "spoiler" CASCADE;
ALTER TABLE "review" DROP COLUMN "visibility" CASCADE;
ALTER TABLE "review" DROP COLUMN "user_id" CASCADE;
ALTER TABLE "review" DROP COLUMN "metadata_id" CASCADE;
ALTER TABLE "review" DROP COLUMN "person_id" CASCADE;
ALTER TABLE "review" DROP COLUMN "metadata_group_id" CASCADE;
ALTER TABLE "review" DROP COLUMN "comments" CASCADE;
ALTER TABLE "review" DROP COLUMN "show_extra_information" CASCADE;
ALTER TABLE "review" DROP COLUMN "podcast_extra_information" CASCADE;
ALTER TABLE "review" DROP COLUMN "anime_extra_information" CASCADE;
ALTER TABLE "review" DROP COLUMN "manga_extra_information" CASCADE;
ALTER TABLE "review" DROP COLUMN "collection_id" CASCADE;

-- Step 5: Rename temporary columns back to original column names
ALTER TABLE "review" RENAME COLUMN "temp__posted_on" TO "posted_on";
ALTER TABLE "review" RENAME COLUMN "temp__rating" TO "rating";
ALTER TABLE "review" RENAME COLUMN "temp__text" TO "text";
ALTER TABLE "review" RENAME COLUMN "temp__spoiler" TO "spoiler";
ALTER TABLE "review" RENAME COLUMN "temp__visibility" TO "visibility";
ALTER TABLE "review" RENAME COLUMN "temp__user_id" TO "user_id";
ALTER TABLE "review" RENAME COLUMN "temp__metadata_id" TO "metadata_id";
ALTER TABLE "review" RENAME COLUMN "temp__person_id" TO "person_id";
ALTER TABLE "review" RENAME COLUMN "temp__metadata_group_id" TO "metadata_group_id";
ALTER TABLE "review" RENAME COLUMN "temp__comments" TO "comments";
ALTER TABLE "review" RENAME COLUMN "temp__show_extra_information" TO "show_extra_information";
ALTER TABLE "review" RENAME COLUMN "temp__podcast_extra_information" TO "podcast_extra_information";
ALTER TABLE "review" RENAME COLUMN "temp__anime_extra_information" TO "anime_extra_information";
ALTER TABLE "review" RENAME COLUMN "temp__manga_extra_information" TO "manga_extra_information";
ALTER TABLE "review" RENAME COLUMN "temp__collection_id" TO "collection_id";

-- Step 6: Recreate any necessary indexes
-- No additional indexes to recreate as the primary key index remains unchanged

-- Step 7: Recreate foreign keys
ALTER TABLE "review" ADD CONSTRAINT "review_to_collection_foreign_key" FOREIGN KEY ("collection_id") REFERENCES "collection"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_to_metadata_foreign_key" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_to_metadata_group_foreign_key" FOREIGN KEY ("metadata_group_id") REFERENCES "metadata_group"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_to_person_foreign_key" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_to_user_foreign_key" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON UPDATE CASCADE ON DELETE CASCADE;
"#,
        )
        .await?;

        tracing::info!("Complete...\n\n");
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
