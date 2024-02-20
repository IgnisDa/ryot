use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
                r#"
WITH duplicates AS (
    SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY metadata_id, metadata_show_extra_information, metadata_podcast_extra_information ORDER BY id) AS row_num
    FROM
        calendar_event
)
DELETE FROM
    calendar_event
WHERE
    id IN (SELECT id FROM duplicates WHERE row_num > 1);
"#,
)
.await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
