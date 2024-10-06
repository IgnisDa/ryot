use enums::MediaLot;
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(&format!(
            r#"
UPDATE "user"
SET preferences = jsonb_set(
    preferences,
    '{{general,watch_providers}}',
    jsonb_build_array(
        jsonb_build_object(
            'lot', '{}',
            'values', preferences -> 'general' -> 'watch_providers'
        )
    )
);
"#,
            MediaLot::Movie
        ))
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
