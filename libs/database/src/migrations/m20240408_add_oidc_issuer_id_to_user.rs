use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user", "oidc_isser_id").await? {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(User::Table)
                        .add_column(ColumnDef::new(User::OidcIssuerId).text())
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
