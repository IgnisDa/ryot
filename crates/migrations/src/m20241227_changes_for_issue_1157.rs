use sea_orm_migration::prelude::*;

use crate::m20230413_create_person::create_metadata_group_to_person_table;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_table("metadata_group_to_person").await? {
            create_metadata_group_to_person_table(manager).await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
