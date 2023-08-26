use sea_orm_migration::prelude::*;

use crate::migrator::m20230410_create_metadata::METADATA_IDENTIFIER_INDEX;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        dbg!(
            manager
                .has_index(
                    "metadata",
                    // METADATA_IDENTIFIER_INDEX,
                    "metadata_key_unique"
                )
                .await?
        );
        panic!();
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
