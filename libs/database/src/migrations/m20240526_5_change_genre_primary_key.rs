use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue};
use sea_orm_migration::prelude::*;

use super::m20240526_0_change_collection_primary_key::get_whether_column_is_text;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "genre")]
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
        if get_whether_column_is_text("genre", "id", db).await? {
            return Ok(());
        }

        db.execute_unprepared(
            r#"
ALTER TABLE "genre" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "genre" SET "new_id" = 'new_prefix_' || "id";
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "metadata_to_genre" ADD COLUMN "new_genre_id" text;

UPDATE "metadata_to_genre" SET "new_genre_id" = 'new_prefix_' || "genre_id";

ALTER TABLE "metadata_to_genre" DROP CONSTRAINT "fk-genre_id-metadata_id";

ALTER TABLE "genre" DROP CONSTRAINT "genre_pkey";
ALTER TABLE "genre" DROP COLUMN "id";
ALTER TABLE "genre" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "genre" ADD PRIMARY KEY ("id");

ALTER TABLE "genre" ADD COLUMN "temp_id" text;
UPDATE "genre" SET "temp_id" = "id";

ALTER TABLE "metadata_to_genre" DROP COLUMN "genre_id";
ALTER TABLE "metadata_to_genre" RENAME COLUMN "new_genre_id" TO "genre_id";

ALTER TABLE "metadata_to_genre" ADD CONSTRAINT "fk-genre_id-metadata_id" FOREIGN KEY ("genre_id") REFERENCES "genre"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "metadata_to_genre"
ADD CONSTRAINT "pk-metadata_genre" PRIMARY KEY (metadata_id, genre_id);
"#,
        )
        .await?;
        for col in Entity::find().all(db).await? {
            let new_id = format!("gen_{}", nanoid!(12));
            let mut col: ActiveModel = col.into();
            col.temp_id = ActiveValue::Set(new_id);
            col.update(db).await?;
        }
        db.execute_unprepared(r#"UPDATE "genre" SET "id" = "temp_id""#)
            .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "metadata_to_genre"
ALTER COLUMN "genre_id" SET NOT NULL;
"#,
        )
        .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "genre" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "genre" DROP COLUMN "temp_id";
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
