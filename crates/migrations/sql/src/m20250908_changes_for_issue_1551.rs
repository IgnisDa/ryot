use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(r#"DROP INDEX IF EXISTS "collection_to_entity_entity_id_idx""#)
            .await?;

        db.execute_unprepared(
            r#"
UPDATE "user" SET "extra_information" =
JSONB_SET("extra_information", '{is_onboarding_tour_completed}', 'false')
WHERE "extra_information" IS NOT NULL
"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
