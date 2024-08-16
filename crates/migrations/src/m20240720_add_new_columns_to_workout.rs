use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("workout", "template_id").await? {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"
ALTER TABLE "workout" ADD COLUMN "template_id" TEXT;
ALTER TABLE "workout" ADD CONSTRAINT "template_to_workout_foreign_key" FOREIGN KEY ("template_id") REFERENCES "workout_template" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user" ALTER COLUMN "created_on" SET NOT NULL;
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
