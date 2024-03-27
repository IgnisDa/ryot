use sea_orm_migration::prelude::*;

use super::{
    m20230501_create_metadata_group::MetadataGroup,
    m20231017_create_user_to_entity::{
        UserToEntity, METADATA_GROUP_FK_NAME, METADATA_GROUP_INDEX_NAME,
    },
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("user_to_entity", "metadata_group_id")
            .await?
        {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(UserToEntity::Table)
                        .add_column(ColumnDef::new(UserToEntity::MetadataGroupId).integer())
                        .to_owned(),
                )
                .await?;
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(UserToEntity::Table)
                        .add_foreign_key(
                            TableForeignKey::new()
                                .name(METADATA_GROUP_FK_NAME)
                                .from_tbl(UserToEntity::Table)
                                .from_col(UserToEntity::MetadataGroupId)
                                .to_tbl(MetadataGroup::Table)
                                .to_col(MetadataGroup::Id)
                                .on_delete(ForeignKeyAction::Cascade)
                                .on_update(ForeignKeyAction::Cascade),
                        )
                        .to_owned(),
                )
                .await?;
            manager
                .create_index(
                    Index::create()
                        .unique()
                        .name(METADATA_GROUP_INDEX_NAME)
                        .table(UserToEntity::Table)
                        .col(UserToEntity::UserId)
                        .col(UserToEntity::MetadataGroupId)
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
