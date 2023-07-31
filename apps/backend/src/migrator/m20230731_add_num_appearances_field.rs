use sea_orm_migration::prelude::*;

use super::m20230730_create_creator::MetadataToCreator;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230731_add_num_appearances_field"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("metadata_to_creator", "num_appearances")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(MetadataToCreator::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(MetadataToCreator::NumAppearances)
                                .integer()
                                .not_null()
                                .default(1),
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
