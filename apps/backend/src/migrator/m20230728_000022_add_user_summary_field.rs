use sea_orm_migration::prelude::*;

use crate::migrator::m20230417_000002_create_user::User;

use super::m20230504_000005_create_summary::Summary;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230728_000022_add_user_summary_field"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user", "summary").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(User::Table)
                        .add_column_if_not_exists(ColumnDef::new(User::Summary).json())
                        .to_owned(),
                )
                .await?;
        }
        if manager.has_table("summary").await? {
            manager
                .drop_table(Table::drop().table(Summary::Table).to_owned())
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
