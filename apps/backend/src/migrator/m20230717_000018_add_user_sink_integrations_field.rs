use sea_orm_migration::prelude::*;

use crate::migrator::m20230417_000002_create_user::User;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230717_000018_add_user_sink_integrations_field"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user", "sink_integrations").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(User::Table)
                        .add_column_if_not_exists(ColumnDef::new(User::SinkIntegrations).json())
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
