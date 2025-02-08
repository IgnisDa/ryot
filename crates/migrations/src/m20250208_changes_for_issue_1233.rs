use sea_orm_migration::prelude::*;

use crate::m20230413_create_person::PERSON_ASSOCIATED_METADATA_COUNT_GENERATED_SQL;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager
            .has_column("person", "associated_metadata_count")
            .await?
        {
            db.execute_unprepared(
                &format!(r#"ALTER TABLE "person" ADD COLUMN "associated_metadata_count" INTEGER NOT NULL {}"#, PERSON_ASSOCIATED_METADATA_COUNT_GENERATED_SQL),
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
