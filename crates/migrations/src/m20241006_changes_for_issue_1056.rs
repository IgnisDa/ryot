use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
UPDATE "user"
SET preferences = jsonb_set(
    preferences,
    '{general,watch_providers}',
    jsonb_build_array(
        jsonb_build_object(
            'lot', 'movie',
            'values', preferences -> 'general' -> 'watch_providers'
        )
    )
);
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
