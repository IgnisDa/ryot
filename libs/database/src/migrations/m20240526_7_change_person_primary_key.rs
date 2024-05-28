use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

use super::m20240526_0_change_collection_primary_key::get_whether_column_is_text;

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

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
