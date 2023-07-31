use sea_orm_migration::prelude::*;

use super::m20230730_create_creator::MetadataToCreator;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230731_add_index_field_to_creators"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("metadata_to_creator", "index").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(MetadataToCreator::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(MetadataToCreator::Index)
                                .integer()
                                .not_null()
                                .default(0),
                        )
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
