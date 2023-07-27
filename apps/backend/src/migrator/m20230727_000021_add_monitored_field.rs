use sea_orm_migration::prelude::*;

use crate::migrator::m20230417_000002_create_user::UserToMetadata;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230727_000021_add_monitored_field"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user_to_metadata", "monitored").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(UserToMetadata::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(UserToMetadata::Monitored)
                                .boolean()
                                .default(false)
                                .not_null(),
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
