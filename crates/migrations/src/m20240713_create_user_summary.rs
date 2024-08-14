use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

pub static USER_STATISTIC_PRIMARY_KEY: &str = "pk-user_summary";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum UserSummary {
    Table,
    UserId,
    CalculatedOn,
    IsFresh,
    Data,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserSummary::Table)
                    .col(ColumnDef::new(UserSummary::UserId).text().not_null())
                    .col(
                        ColumnDef::new(UserSummary::CalculatedOn)
                            .timestamp()
                            .not_null(),
                    )
                    .col(ColumnDef::new(UserSummary::IsFresh).boolean().not_null())
                    .col(ColumnDef::new(UserSummary::Data).json_binary().not_null())
                    .primary_key(
                        Index::create()
                            .name(USER_STATISTIC_PRIMARY_KEY)
                            .col(UserSummary::UserId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_summary_to_user_foreign_key")
                            .from(UserSummary::Table, UserSummary::UserId)
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
