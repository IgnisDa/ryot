use sea_orm_migration::prelude::*;

use crate::m20231017_create_user_to_entity::CONSTRAINT_SQL;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("user_to_entity", "collection_id")
            .await?
            && manager.has_table("user_to_collection").await?
        {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"
ALTER TABLE "user_to_entity" ADD COLUMN "collection_id" TEXT;
ALTER TABLE "user_to_entity" ADD CONSTRAINT "user_to_entity-fk6" FOREIGN KEY ("collection_id") REFERENCES "collection" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "user_to_entity-uqi5" ON "user_to_entity" ("user_id", "collection_id");
"#,
            )
            .await?;
            db.execute_unprepared(CONSTRAINT_SQL).await?;
            db.execute_unprepared(
                r#"
INSERT INTO "user_to_entity" ("user_id", "collection_id") SELECT "user_id", "collection_id" FROM "user_to_collection";
DROP TABLE "user_to_collection";
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
