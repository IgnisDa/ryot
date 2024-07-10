use sea_orm::{DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

async fn get_whether_column_is_uuid<'a>(
    table_name: &str,
    column_name: &str,
    db: &SchemaManagerConnection<'a>,
) -> Result<bool, DbErr> {
    let resp = db.query_one(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"SELECT data_type = 'uuid' as is_uuid FROM information_schema.columns WHERE table_name = $1 AND column_name = $2"#,
        [table_name.into(), column_name.into()]
    ))
    .await?
    .unwrap();
    let is_text: bool = resp.try_get("", "is_uuid")?;
    Ok(is_text)
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        if !get_whether_column_is_uuid("user_to_entity", "id", db).await? {
            db.execute_unprepared(
                r#"
ALTER TABLE "user_to_entity" ADD COLUMN "new_id" UUID DEFAULT gen_random_uuid();
UPDATE "user_to_entity" SET "new_id" = gen_random_uuid() WHERE "new_id" IS NULL;
ALTER TABLE "user_to_entity" DROP CONSTRAINT "user_to_entity_pkey";
ALTER TABLE "user_to_entity" DROP COLUMN "id";
ALTER TABLE "user_to_entity" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "user_to_entity" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "user_to_entity" ADD CONSTRAINT "user_to_entity_pkey" PRIMARY KEY ("id");
"#,
            )
            .await?;
        }

        if !get_whether_column_is_uuid("metadata_to_metadata", "id", db).await? {
            db.execute_unprepared(
                r#"
ALTER TABLE "metadata_to_metadata" ADD COLUMN "new_id" UUID DEFAULT gen_random_uuid();
UPDATE "metadata_to_metadata" SET "new_id" = gen_random_uuid() WHERE "new_id" IS NULL;
ALTER TABLE "metadata_to_metadata" DROP CONSTRAINT "metadata_to_metadata_pkey";
ALTER TABLE "metadata_to_metadata" DROP COLUMN "id";
ALTER TABLE "metadata_to_metadata" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "metadata_to_metadata" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "metadata_to_metadata" ADD CONSTRAINT "metadata_to_metadata_pkey" PRIMARY KEY ("id");
"#,
            )
            .await?;
        }

        if !get_whether_column_is_uuid("collection_to_entity", "id", db).await? {
            db.execute_unprepared(
                r#"
ALTER TABLE "collection_to_entity" ADD COLUMN "new_id" UUID DEFAULT gen_random_uuid();
UPDATE "collection_to_entity" SET "new_id" = gen_random_uuid() WHERE "new_id" IS NULL;
ALTER TABLE "collection_to_entity" DROP CONSTRAINT "collection_to_entity_pkey";
ALTER TABLE "collection_to_entity" DROP COLUMN "id";
ALTER TABLE "collection_to_entity" RENAME COLUMN "new_id" TO "id";
ALTER TABLE "collection_to_entity" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "collection_to_entity" ADD CONSTRAINT "collection_to_entity_pkey" PRIMARY KEY ("id");
"#,
            )
            .await?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
