use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
UPDATE "user" SET "preferences" = jsonb_set("preferences", '{general,grid_packing}', '"Dense"');
"#,
        )
        .await?;
        if !manager.has_column("seen", "review_id").await? {
            db.execute_unprepared(
            r#"
ALTER TABLE "seen" ADD COLUMN "review_id" TEXT;
ALTER TABLE "seen" ADD CONSTRAINT "review_to_seen_foreign_key" FOREIGN KEY ("review_id") REFERENCES "review" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
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
