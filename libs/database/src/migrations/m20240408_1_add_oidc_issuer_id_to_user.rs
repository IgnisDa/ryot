use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("user", "oidc_issuer_id").await? {
            let db = manager.get_connection();
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(User::Table)
                        .add_column(ColumnDef::new(User::OidcIssuerId).unique_key().text())
                        .to_owned(),
                )
                .await?;
            db.execute_unprepared(r#"alter table "user" alter column password drop not null;"#)
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
