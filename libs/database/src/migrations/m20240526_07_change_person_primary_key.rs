use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

use super::get_whether_column_is_text;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "person")]
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
        if get_whether_column_is_text("person", "id", db).await? {
            return Ok(());
        }

        tracing::warn!("Starting to change person primary key to text");
        db.execute_unprepared(
            r#"
ALTER TABLE "person" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "person" SET "new_id" = 'per_' || "id";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "collection_to_entity" ADD COLUMN "new_person_id" text;
ALTER TABLE "review" ADD COLUMN "new_person_id" text;
ALTER TABLE "metadata_to_person" ADD COLUMN "new_person_id" text;
ALTER TABLE "user_to_entity" ADD COLUMN "new_person_id" text;

UPDATE "collection_to_entity" SET "new_person_id" = 'per_' || "person_id";
UPDATE "review" SET "new_person_id" = 'per_' || "person_id";
UPDATE "metadata_to_person" SET "new_person_id" = 'per_' || "person_id";
UPDATE "user_to_entity" SET "new_person_id" = 'per_' || "person_id";

ALTER TABLE "collection_to_entity" DROP CONSTRAINT "collection_to_entity-fk3";
ALTER TABLE "review" DROP CONSTRAINT "review_to_person_foreign_key";
ALTER TABLE "metadata_to_person" DROP CONSTRAINT "fk-person-item_media-person_id";
ALTER TABLE "user_to_entity" DROP CONSTRAINT "user_to_entity-fk4";

ALTER TABLE "person" DROP CONSTRAINT "person_pkey";
ALTER TABLE "person" DROP COLUMN "id";
ALTER TABLE "person" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "person" ADD PRIMARY KEY ("id");

ALTER TABLE "person" ADD COLUMN "temp_id" text;
UPDATE "person" SET "temp_id" = "id";

ALTER TABLE "collection_to_entity" DROP COLUMN "person_id";
ALTER TABLE "collection_to_entity" RENAME COLUMN "new_person_id" TO "person_id";

ALTER TABLE "review" DROP COLUMN "person_id";
ALTER TABLE "review" RENAME COLUMN "new_person_id" TO "person_id";

ALTER TABLE "metadata_to_person" DROP COLUMN "person_id";
ALTER TABLE "metadata_to_person" RENAME COLUMN "new_person_id" TO "person_id";

ALTER TABLE "user_to_entity" DROP COLUMN "person_id";
ALTER TABLE "user_to_entity" RENAME COLUMN "new_person_id" TO "person_id";

ALTER TABLE "collection_to_entity" ADD CONSTRAINT "collection_to_entity-fk3" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_to_person_foreign_key" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "metadata_to_person" ADD CONSTRAINT "fk-person-item_media-person_id" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "user_to_entity" ADD CONSTRAINT "user_to_entity-fk4" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "metadata_to_person"
ADD CONSTRAINT "pk-media-item_person" PRIMARY KEY (metadata_id, person_id, role);
CREATE UNIQUE INDEX "collection_to_entity_uqi2" ON "collection_to_entity" ("collection_id", "person_id");
CREATE UNIQUE INDEX "user_to_entity-uqi3" ON "user_to_entity" ("user_id", "person_id");
            "#,
        )
        .await?;

        for person in Entity::find().all(db).await? {
            let new_id = format!("per_{}", nanoid!(12));
            let mut person: ActiveModel = person.into();
            person.temp_id = ActiveValue::Set(new_id);
            person.update(db).await?;
        }
        db.execute_unprepared(r#"UPDATE "person" SET "id" = "temp_id""#)
            .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "metadata_to_person"
ALTER COLUMN "person_id" SET NOT NULL;
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
ALTER TABLE "person" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "person" DROP COLUMN "temp_id";
            "#,
        )
        .await?;

        db.execute_unprepared(
            r#"
-- Step 1: Add temporary columns
ALTER TABLE "person" ADD COLUMN "temp__identifier" text;
ALTER TABLE "person" ADD COLUMN "temp__source" text;
ALTER TABLE "person" ADD COLUMN "temp__created_on" timestamp with time zone DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "person" ADD COLUMN "temp__last_updated_on" timestamp with time zone DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "person" ADD COLUMN "temp__name" text;
ALTER TABLE "person" ADD COLUMN "temp__description" text;
ALTER TABLE "person" ADD COLUMN "temp__gender" text;
ALTER TABLE "person" ADD COLUMN "temp__birth_date" date;
ALTER TABLE "person" ADD COLUMN "temp__death_date" date;
ALTER TABLE "person" ADD COLUMN "temp__place" text;
ALTER TABLE "person" ADD COLUMN "temp__website" text;
ALTER TABLE "person" ADD COLUMN "temp__images" jsonb;
ALTER TABLE "person" ADD COLUMN "temp__is_partial" boolean;
ALTER TABLE "person" ADD COLUMN "temp__source_specifics" jsonb;
ALTER TABLE "person" ADD COLUMN "temp__state_changes" jsonb;

-- Step 2: Update temporary columns with the values from original columns
UPDATE "person" SET
    "temp__identifier" = "identifier",
    "temp__source" = "source",
    "temp__created_on" = "created_on",
    "temp__last_updated_on" = "last_updated_on",
    "temp__name" = "name",
    "temp__description" = "description",
    "temp__gender" = "gender",
    "temp__birth_date" = "birth_date",
    "temp__death_date" = "death_date",
    "temp__place" = "place",
    "temp__website" = "website",
    "temp__images" = "images",
    "temp__is_partial" = "is_partial",
    "temp__source_specifics" = "source_specifics",
    "temp__state_changes" = '{"media_associated": []}';

-- Step 3: Set temporary columns to not null if the original columns were not null
ALTER TABLE "person" ALTER COLUMN "temp__identifier" SET NOT NULL;
ALTER TABLE "person" ALTER COLUMN "temp__source" SET NOT NULL;
ALTER TABLE "person" ALTER COLUMN "temp__created_on" SET NOT NULL;
ALTER TABLE "person" ALTER COLUMN "temp__last_updated_on" SET NOT NULL;
ALTER TABLE "person" ALTER COLUMN "temp__name" SET NOT NULL;

-- Step 4: Drop original columns with CASCADE
ALTER TABLE "person" DROP COLUMN "identifier" CASCADE;
ALTER TABLE "person" DROP COLUMN "source" CASCADE;
ALTER TABLE "person" DROP COLUMN "created_on" CASCADE;
ALTER TABLE "person" DROP COLUMN "last_updated_on" CASCADE;
ALTER TABLE "person" DROP COLUMN "name" CASCADE;
ALTER TABLE "person" DROP COLUMN "description" CASCADE;
ALTER TABLE "person" DROP COLUMN "gender" CASCADE;
ALTER TABLE "person" DROP COLUMN "birth_date" CASCADE;
ALTER TABLE "person" DROP COLUMN "death_date" CASCADE;
ALTER TABLE "person" DROP COLUMN "place" CASCADE;
ALTER TABLE "person" DROP COLUMN "website" CASCADE;
ALTER TABLE "person" DROP COLUMN "images" CASCADE;
ALTER TABLE "person" DROP COLUMN "is_partial" CASCADE;
ALTER TABLE "person" DROP COLUMN "source_specifics" CASCADE;
ALTER TABLE "person" DROP COLUMN "state_changes" CASCADE;

-- Step 5: Rename temporary columns back to original column names
ALTER TABLE "person" RENAME COLUMN "temp__identifier" TO "identifier";
ALTER TABLE "person" RENAME COLUMN "temp__source" TO "source";
ALTER TABLE "person" RENAME COLUMN "temp__created_on" TO "created_on";
ALTER TABLE "person" RENAME COLUMN "temp__last_updated_on" TO "last_updated_on";
ALTER TABLE "person" RENAME COLUMN "temp__name" TO "name";
ALTER TABLE "person" RENAME COLUMN "temp__description" TO "description";
ALTER TABLE "person" RENAME COLUMN "temp__gender" TO "gender";
ALTER TABLE "person" RENAME COLUMN "temp__birth_date" TO "birth_date";
ALTER TABLE "person" RENAME COLUMN "temp__death_date" TO "death_date";
ALTER TABLE "person" RENAME COLUMN "temp__place" TO "place";
ALTER TABLE "person" RENAME COLUMN "temp__website" TO "website";
ALTER TABLE "person" RENAME COLUMN "temp__images" TO "images";
ALTER TABLE "person" RENAME COLUMN "temp__is_partial" TO "is_partial";
ALTER TABLE "person" RENAME COLUMN "temp__source_specifics" TO "source_specifics";
ALTER TABLE "person" RENAME COLUMN "temp__state_changes" TO "state_changes";

-- Step 6: Recreate indexes
CREATE UNIQUE INDEX "person-identifier-source__unique_index" ON "person" ("identifier", "source", "source_specifics") NULLS NOT DISTINCT;
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
