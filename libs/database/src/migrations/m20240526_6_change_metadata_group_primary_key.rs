use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

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
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
