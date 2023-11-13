use sea_orm_migration::prelude::*;

use crate::migrations::m20231017_create_user_to_entity::UserToEntity;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("user_to_entity", "metadata_ownership")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(UserToEntity::Table)
                        .add_column(ColumnDef::new(UserToEntity::MetadataOwnership).json_binary())
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
