use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager
            .has_column("import_report", "estimated_finish_time")
            .await?
        {
            db.execute_unprepared(
                r#"
ALTER TABLE "import_report" ADD COLUMN "estimated_finish_time" timestamp with time zone;
UPDATE "import_report" SET "estimated_finish_time" = ("started_on" + interval '1 hour');
ALTER TABLE "import_report" ALTER COLUMN "estimated_finish_time" SET NOT NULL;
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
