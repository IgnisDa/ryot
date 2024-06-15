use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_column("review", "is_spoiler").await? {
            db.execute_unprepared(
                r#"ALTER TABLE "review" RENAME COLUMN "spoiler" TO "is_spoiler""#,
            )
            .await?;
        }
        if !manager.has_column("import_report", "was_success").await? {
            db.execute_unprepared(
                r#"ALTER TABLE "import_report" RENAME COLUMN "success" TO "was_success""#,
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
