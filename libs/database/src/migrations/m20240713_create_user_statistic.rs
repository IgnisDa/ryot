use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

pub static USER_STATISTIC_PRIMARY_KEY: &str = "pk-user_statistic";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum UserStatistic {
    Table,
    Lot,
    UserId,
    Data,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserStatistic::Table)
                    .col(ColumnDef::new(UserStatistic::UserId).text().not_null())
                    .col(ColumnDef::new(UserStatistic::Lot).text().not_null())
                    .primary_key(
                        Index::create()
                            .name(USER_STATISTIC_PRIMARY_KEY)
                            .col(UserStatistic::UserId)
                            .col(UserStatistic::Lot),
                    )
                    .col(ColumnDef::new(UserStatistic::Data).json_binary().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_statistic_to_user_foreign_key")
                            .from(UserStatistic::Table, UserStatistic::UserId)
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
