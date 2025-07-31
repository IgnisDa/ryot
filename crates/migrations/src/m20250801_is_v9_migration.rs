use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
ALTER TABLE calendar_event ALTER COLUMN "date" SET NOT NULL;

ALTER TABLE collection_to_entity ALTER COLUMN "entity_id" SET NOT NULL;
ALTER TABLE collection_to_entity ALTER COLUMN "entity_lot" SET NOT NULL;

ALTER TABLE exercise ALTER COLUMN "muscles" SET NOT NULL;

ALTER TABLE review ALTER COLUMN "entity_lot" SET NOT NULL;
        "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
