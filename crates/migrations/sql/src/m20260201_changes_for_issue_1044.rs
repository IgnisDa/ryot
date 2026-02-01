use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
ALTER TABLE metadata ADD COLUMN IF NOT EXISTS "comic_book_specifics" JSONB;
ALTER TABLE daily_user_activity ADD COLUMN IF NOT EXISTS "comic_book_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE daily_user_activity ADD COLUMN IF NOT EXISTS "comic_book_pages" INTEGER NOT NULL DEFAULT 0;
            "#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
