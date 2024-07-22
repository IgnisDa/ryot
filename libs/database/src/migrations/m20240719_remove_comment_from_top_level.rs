use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("workout", "comment").await? {
            let db = manager.get_connection();
            db.execute_unprepared(
                r#"
UPDATE "workout" SET "information" = jsonb_set(information, '{comment}', to_jsonb(comment))
WHERE "comment" IS NOT NULL;

ALTER TABLE "workout" DROP COLUMN "comment";
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
