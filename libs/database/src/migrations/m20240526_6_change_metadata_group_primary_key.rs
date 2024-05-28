use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

use super::m20240526_0_change_collection_primary_key::get_whether_column_is_text;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "metadata_group")]
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
        if get_whether_column_is_text("metadata_group", "id", db).await? {
            return Ok(());
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "metadata_group" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "metadata_group" SET "new_id" = 'meg_' || "id";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "collection_to_entity" ADD COLUMN "new_metadata_group_id" text;
ALTER TABLE "review" ADD COLUMN "new_metadata_group_id" text;
ALTER TABLE "metadata_to_metadata_group" ADD COLUMN "new_metadata_group_id" text;
ALTER TABLE "user_to_entity" ADD COLUMN "new_metadata_group_id" text;

UPDATE "collection_to_entity" SET "new_metadata_group_id" = 'meg_' || "metadata_group_id";
UPDATE "review" SET "new_metadata_group_id" = 'meg_' || "metadata_group_id";
UPDATE "metadata_to_metadata_group" SET "new_metadata_group_id" = 'meg_' || "metadata_group_id";
UPDATE "user_to_entity" SET "new_metadata_group_id" = 'meg_' || "metadata_group_id";

ALTER TABLE "collection_to_entity" DROP CONSTRAINT "collection_to_entity-fk4";
ALTER TABLE "review" DROP CONSTRAINT "review_to_metadata_group_foreign_key";
ALTER TABLE "metadata_to_metadata_group" DROP CONSTRAINT "metadata_to_metadata_group_metadata_group_id_fkey";
ALTER TABLE "user_to_entity" DROP CONSTRAINT "user_to_entity-fk5";

ALTER TABLE "metadata_group" DROP CONSTRAINT "metadata_group_pkey";
ALTER TABLE "metadata_group" DROP COLUMN "id";
ALTER TABLE "metadata_group" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "metadata_group" ADD PRIMARY KEY ("id");

ALTER TABLE "metadata_group" ADD COLUMN "temp_id" text;
UPDATE "metadata_group" SET "temp_id" = "id";

ALTER TABLE "collection_to_entity" DROP COLUMN "metadata_group_id";
ALTER TABLE "collection_to_entity" RENAME COLUMN "new_metadata_group_id" TO "metadata_group_id";

ALTER TABLE "review" DROP COLUMN "metadata_group_id";
ALTER TABLE "review" RENAME COLUMN "new_metadata_group_id" TO "metadata_group_id";

ALTER TABLE "metadata_to_metadata_group" DROP COLUMN "metadata_group_id";
ALTER TABLE "metadata_to_metadata_group" RENAME COLUMN "new_metadata_group_id" TO "metadata_group_id";

ALTER TABLE "user_to_entity" DROP COLUMN "metadata_group_id";
ALTER TABLE "user_to_entity" RENAME COLUMN "new_metadata_group_id" TO "metadata_group_id";

ALTER TABLE "collection_to_entity" ADD CONSTRAINT "collection_to_entity-fk4" FOREIGN KEY ("metadata_group_id") REFERENCES "metadata_group"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_to_metadata_group_foreign_key" FOREIGN KEY ("metadata_group_id") REFERENCES "metadata_group"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "metadata_to_metadata_group" ADD CONSTRAINT "metadata_to_metadata_group_metadata_group_id_fkey" FOREIGN KEY ("metadata_group_id") REFERENCES "metadata_group"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "user_to_entity" ADD CONSTRAINT "user_to_entity-fk5" FOREIGN KEY ("metadata_group_id") REFERENCES "metadata_group"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "metadata_to_metadata_group"
ADD CONSTRAINT "metadata_to_metadata_group_pkey" PRIMARY KEY (metadata_id, metadata_group_id);
CREATE UNIQUE INDEX "collection_to_entity_uqi3" ON "collection_to_entity" ("collection_id", "metadata_group_id");
CREATE UNIQUE INDEX "user_to_entity-uqi4" ON "user_to_entity" ("user_id", "metadata_group_id");
            "#,
        )
        .await?;

        for mg in Entity::find().all(db).await? {
            let new_id = format!("meg_{}", nanoid!(12));
            let mut mg: ActiveModel = mg.into();
            mg.temp_id = ActiveValue::Set(new_id);
            mg.update(db).await?;
        }

        db.execute_unprepared(r#"UPDATE "metadata_group" SET "id" = "temp_id""#)
            .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "metadata_to_metadata_group"
ALTER COLUMN "metadata_group_id" SET NOT NULL;
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "metadata_group" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "metadata_group" DROP COLUMN "temp_id";
"#,
        )
        .await?;

        db.execute_unprepared(
            r#"
-- Step 1: Add temporary columns
ALTER TABLE "metadata_group" ADD COLUMN "temp__identifier" text;
ALTER TABLE "metadata_group" ADD COLUMN "temp__parts" integer;
ALTER TABLE "metadata_group" ADD COLUMN "temp__title" text;
ALTER TABLE "metadata_group" ADD COLUMN "temp__description" text;
ALTER TABLE "metadata_group" ADD COLUMN "temp__lot" text;
ALTER TABLE "metadata_group" ADD COLUMN "temp__source" text;
ALTER TABLE "metadata_group" ADD COLUMN "temp__images" jsonb;
ALTER TABLE "metadata_group" ADD COLUMN "temp__is_partial" boolean;

-- Step 2: Update temporary columns with the values from original columns
UPDATE "metadata_group" SET
    "temp__identifier" = "identifier",
    "temp__parts" = "parts",
    "temp__title" = "title",
    "temp__description" = "description",
    "temp__lot" = "lot",
    "temp__source" = "source",
    "temp__images" = "images",
    "temp__is_partial" = "is_partial";

-- Step 3: Set temporary columns to not null if the original columns were not null
ALTER TABLE "metadata_group" ALTER COLUMN "temp__identifier" SET NOT NULL;
ALTER TABLE "metadata_group" ALTER COLUMN "temp__parts" SET NOT NULL;
ALTER TABLE "metadata_group" ALTER COLUMN "temp__title" SET NOT NULL;
ALTER TABLE "metadata_group" ALTER COLUMN "temp__lot" SET NOT NULL;
ALTER TABLE "metadata_group" ALTER COLUMN "temp__source" SET NOT NULL;
ALTER TABLE "metadata_group" ALTER COLUMN "temp__images" SET NOT NULL;

-- Step 4: Drop original columns with CASCADE
ALTER TABLE "metadata_group" DROP COLUMN "identifier" CASCADE;
ALTER TABLE "metadata_group" DROP COLUMN "parts" CASCADE;
ALTER TABLE "metadata_group" DROP COLUMN "title" CASCADE;
ALTER TABLE "metadata_group" DROP COLUMN "description" CASCADE;
ALTER TABLE "metadata_group" DROP COLUMN "lot" CASCADE;
ALTER TABLE "metadata_group" DROP COLUMN "source" CASCADE;
ALTER TABLE "metadata_group" DROP COLUMN "images" CASCADE;
ALTER TABLE "metadata_group" DROP COLUMN "is_partial" CASCADE;

-- Step 5: Rename temporary columns back to original column names
ALTER TABLE "metadata_group" RENAME COLUMN "temp__identifier" TO "identifier";
ALTER TABLE "metadata_group" RENAME COLUMN "temp__parts" TO "parts";
ALTER TABLE "metadata_group" RENAME COLUMN "temp__title" TO "title";
ALTER TABLE "metadata_group" RENAME COLUMN "temp__description" TO "description";
ALTER TABLE "metadata_group" RENAME COLUMN "temp__lot" TO "lot";
ALTER TABLE "metadata_group" RENAME COLUMN "temp__source" TO "source";
ALTER TABLE "metadata_group" RENAME COLUMN "temp__images" TO "images";
ALTER TABLE "metadata_group" RENAME COLUMN "temp__is_partial" TO "is_partial";

-- Step 6: Recreate indexes
CREATE UNIQUE INDEX "metadata_group-identifier-source-lot__unique-index" ON "metadata_group" ("identifier", "source", "lot");
"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
