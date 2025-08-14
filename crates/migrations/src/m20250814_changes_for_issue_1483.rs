use sea_orm_migration::prelude::*;

use super::{
    m20230404_create_user::IS_DISABLED_INDEX,
    m20231016_create_collection_to_entity::{COMPOSITE_INDEX, ENTITY_ID_INDEX, ENTITY_LOT_INDEX},
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(&format!(
            r#"
            CREATE INDEX IF NOT EXISTS {IS_DISABLED_INDEX} ON "user" (is_disabled);
            CREATE INDEX IF NOT EXISTS {ENTITY_ID_INDEX} ON collection_to_entity (entity_id);
            CREATE INDEX IF NOT EXISTS {ENTITY_LOT_INDEX} ON collection_to_entity (entity_lot);
            CREATE INDEX IF NOT EXISTS {COMPOSITE_INDEX} ON collection_to_entity (collection_id, entity_id, entity_lot);
            "#
        ))
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
