use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_column("import_report", "progress").await? {
            db.execute_unprepared(r#"ALTER TABLE "import_report" ADD COLUMN "progress" DECIMAL"#)
                .await?;
        }
        db.execute_unprepared(
            r#"
UPDATE "import_report" SET "source" = 'myanimelist' WHERE "source" = 'mal';
UPDATE "import_report" SET "source" = 'mediatracker' WHERE "source" = 'media_tracker';
UPDATE "import_report" SET "source" = 'storygraph' WHERE "source" = 'story_graph';
            "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
