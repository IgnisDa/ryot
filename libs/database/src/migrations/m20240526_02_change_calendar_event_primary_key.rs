use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

use super::get_whether_column_is_text;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "calendar_event")]
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
        if get_whether_column_is_text("calendar_event", "id", db).await? {
            return Ok(());
        }

        tracing::warn!("Starting to change calendar_event primary key to text");
        db.execute_unprepared(
            r#"
ALTER TABLE "calendar_event" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "calendar_event" SET "new_id" = 'cal_' || "id";
            "#,
        )
        .await?;

        for rev in Entity::find().all(db).await? {
            let new_id = format!("cal_{}", nanoid!(12));
            let mut rev: ActiveModel = rev.into();
            rev.new_id = ActiveValue::Set(new_id);
            rev.update(db).await?;
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "calendar_event" DROP CONSTRAINT "calendar_event_pkey";
ALTER TABLE "calendar_event" DROP COLUMN "id";
ALTER TABLE "calendar_event" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "calendar_event" ADD PRIMARY KEY ("id");
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "calendar_event" ALTER COLUMN "id" DROP DEFAULT;
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
-- Step 1: Add temporary columns
ALTER TABLE "calendar_event" ADD COLUMN "temp__date" date;
ALTER TABLE "calendar_event" ADD COLUMN "temp__metadata_id" integer;
ALTER TABLE "calendar_event" ADD COLUMN "temp__metadata_show_extra_information" jsonb;
ALTER TABLE "calendar_event" ADD COLUMN "temp__metadata_podcast_extra_information" jsonb;

-- Step 2: Update temporary columns with the values from original columns
UPDATE "calendar_event" SET
    "temp__date" = "date",
    "temp__metadata_id" = "metadata_id",
    "temp__metadata_show_extra_information" = "metadata_show_extra_information",
    "temp__metadata_podcast_extra_information" = "metadata_podcast_extra_information";

-- Step 3: Set temporary columns to not null if the original columns were not null
ALTER TABLE "calendar_event" ALTER COLUMN "temp__date" SET NOT NULL;

-- Step 4: Drop original columns with CASCADE
ALTER TABLE "calendar_event" DROP COLUMN "date" CASCADE;
ALTER TABLE "calendar_event" DROP COLUMN "metadata_id" CASCADE;
ALTER TABLE "calendar_event" DROP COLUMN "metadata_show_extra_information" CASCADE;
ALTER TABLE "calendar_event" DROP COLUMN "metadata_podcast_extra_information" CASCADE;

-- Step 5: Rename temporary columns back to original column names
ALTER TABLE "calendar_event" RENAME COLUMN "temp__date" TO "date";
ALTER TABLE "calendar_event" RENAME COLUMN "temp__metadata_id" TO "metadata_id";
ALTER TABLE "calendar_event" RENAME COLUMN "temp__metadata_show_extra_information" TO "metadata_show_extra_information";
ALTER TABLE "calendar_event" RENAME COLUMN "temp__metadata_podcast_extra_information" TO "metadata_podcast_extra_information";

-- Step 6: Recreate indexes
CREATE UNIQUE INDEX "calendar_event-date-metadataid-info__uq-idx" ON "calendar_event" ("date", "metadata_id", "metadata_show_extra_information", "metadata_podcast_extra_information") NULLS NOT DISTINCT;

-- Step 7: Recreate foreign keys
ALTER TABLE "calendar_event" ADD CONSTRAINT "fk-calendar_event_to_metadata" FOREIGN KEY ("metadata_id") REFERENCES "metadata"("id") ON UPDATE CASCADE ON DELETE CASCADE;
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
