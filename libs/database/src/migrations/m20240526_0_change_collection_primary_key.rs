use nanoid::nanoid;
use sea_orm::{entity::prelude::*, ActiveValue, DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

pub async fn get_whether_column_is_text<'a>(
    table_name: &str,
    column_name: &str,
    db: &SchemaManagerConnection<'a>,
) -> Result<bool, DbErr> {
    let resp = db.query_one(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"SELECT data_type = 'text' as is_text FROM information_schema.columns WHERE table_name = $1 AND column_name = $2"#,
        [table_name.into(), column_name.into()]
    ))
    .await?
    .unwrap();
    let is_text: bool = resp.try_get("", "is_text")?;
    Ok(is_text)
}

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "collection")]
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
        if get_whether_column_is_text("collection", "id", db).await? {
            return Ok(());
        }
        db.execute_unprepared(
            r#"
ALTER TABLE "collection" ADD COLUMN "new_id" text NOT NULL DEFAULT '';
UPDATE "collection" SET "new_id" = 'new_prefix_' || "id";
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "collection_to_entity" ADD COLUMN "new_collection_id" text;
ALTER TABLE "review" ADD COLUMN "new_collection_id" text;
ALTER TABLE "user_to_collection" ADD COLUMN "new_collection_id" text;

UPDATE "collection_to_entity" SET "new_collection_id" = 'new_prefix_' || "collection_id";
UPDATE "review" SET "new_collection_id" = 'new_prefix_' || "collection_id";
UPDATE "user_to_collection" SET "new_collection_id" = 'new_prefix_' || "collection_id";

ALTER TABLE "collection_to_entity" DROP CONSTRAINT "collection_to_entity-fk1";
ALTER TABLE "review" DROP CONSTRAINT "review_to_collection_foreign_key";
ALTER TABLE "user_to_collection" DROP CONSTRAINT "user_to_collection-fk1";

ALTER TABLE "collection" DROP CONSTRAINT "collection_pkey";
ALTER TABLE "collection" DROP COLUMN "id";
ALTER TABLE "collection" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "collection" ADD PRIMARY KEY ("id");

ALTER TABLE "collection" ADD COLUMN "temp_id" text;
UPDATE "collection" SET "temp_id" = "id";

ALTER TABLE "collection_to_entity" DROP COLUMN "collection_id";
ALTER TABLE "collection_to_entity" RENAME COLUMN "new_collection_id" TO "collection_id";

ALTER TABLE "review" DROP COLUMN "collection_id";
ALTER TABLE "review" RENAME COLUMN "new_collection_id" TO "collection_id";

ALTER TABLE "user_to_collection" DROP COLUMN "collection_id";
ALTER TABLE "user_to_collection" RENAME COLUMN "new_collection_id" TO "collection_id";

ALTER TABLE "collection_to_entity" ADD CONSTRAINT "collection_to_entity-fk1" FOREIGN KEY ("collection_id") REFERENCES "collection"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "review" ADD CONSTRAINT "review_to_collection_foreign_key" FOREIGN KEY ("collection_id") REFERENCES "collection"("id") ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "user_to_collection" ADD CONSTRAINT "user_to_collection-fk1" FOREIGN KEY ("collection_id") REFERENCES "collection"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "user_to_collection"
ADD CONSTRAINT "pk-user_to_collection" PRIMARY KEY (user_id, collection_id);

CREATE UNIQUE INDEX "collection_to_entity_uqi1" ON "collection_to_entity" ("collection_id", "metadata_id");
CREATE UNIQUE INDEX "collection_to_entity_uqi2" ON "collection_to_entity" ("collection_id", "person_id");
CREATE UNIQUE INDEX "collection_to_entity_uqi3" ON "collection_to_entity" ("collection_id", "metadata_group_id");
CREATE UNIQUE INDEX "collection_to_entity_uqi4" ON "collection_to_entity" ("collection_id", "exercise_id");
"#,
        )
        .await?;
        for col in Entity::find().all(db).await? {
            let new_id = format!("col_{}", nanoid!(12));
            let mut col: ActiveModel = col.into();
            col.temp_id = ActiveValue::Set(new_id);
            col.update(db).await?;
        }
        db.execute_unprepared(r#"UPDATE "collection" SET "id" = "temp_id""#)
            .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "user_to_collection"
ALTER COLUMN "collection_id" SET NOT NULL;

ALTER TABLE "collection_to_entity"
ALTER COLUMN "collection_id" SET NOT NULL;
"#,
        )
        .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "collection" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "collection" DROP COLUMN "temp_id";
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
