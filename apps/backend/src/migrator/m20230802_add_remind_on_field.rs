use sea_orm_migration::prelude::*;

use crate::migrator::m20230417_000002_create_user::UserToMetadata;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230802_add_remind_on_field"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user_to_metadata", "remind_on").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(UserToMetadata::Table)
                        .add_column_if_not_exists(
                            ColumnDef::new(UserToMetadata::RemindOn).date_time().null(),
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
