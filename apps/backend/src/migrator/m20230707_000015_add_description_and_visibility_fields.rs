use sea_orm_migration::prelude::*;

use crate::models::media::Visibility;

use super::m20230507_000007_create_collection::Collection;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230707_000015_add_description_and_visibility_fields"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Collection::Table)
                    .add_column_if_not_exists(ColumnDef::new(Collection::Description).string())
                    .add_column_if_not_exists(
                        ColumnDef::new(Collection::Visibility)
                            .string_len(2)
                            .not_null()
                            .default(Visibility::Private),
                    )
                    .to_owned(),
            )
            .await
            .ok();
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
