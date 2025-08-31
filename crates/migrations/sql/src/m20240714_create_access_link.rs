use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum AccessLink {
    Id,
    Name,
    Table,
    UserId,
    CreatedOn,
    ExpiresOn,
    IsRevoked,
    TimesUsed,
    RedirectTo,
    MaximumUses,
    IssuedTokens,
    IsAccountDefault,
    IsMutationAllowed,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AccessLink::Table)
                    .col(
                        ColumnDef::new(AccessLink::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(AccessLink::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(AccessLink::IssuedTokens)
                            .array(ColumnType::Text)
                            .not_null()
                            .default("{}"),
                    )
                    .col(ColumnDef::new(AccessLink::ExpiresOn).timestamp_with_time_zone())
                    .col(
                        ColumnDef::new(AccessLink::TimesUsed)
                            .integer()
                            .not_null()
                            .extra("GENERATED ALWAYS AS (cardinality(issued_tokens)) STORED"),
                    )
                    .col(ColumnDef::new(AccessLink::MaximumUses).integer())
                    .col(ColumnDef::new(AccessLink::IsRevoked).boolean())
                    .col(ColumnDef::new(AccessLink::UserId).text().not_null())
                    .col(ColumnDef::new(AccessLink::Name).text().not_null())
                    .col(ColumnDef::new(AccessLink::IsMutationAllowed).boolean())
                    .col(ColumnDef::new(AccessLink::RedirectTo).text())
                    .col(ColumnDef::new(AccessLink::IsAccountDefault).boolean())
                    .foreign_key(
                        ForeignKey::create()
                            .name("access_link_to_user_foreign_key")
                            .from(AccessLink::Table, AccessLink::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
