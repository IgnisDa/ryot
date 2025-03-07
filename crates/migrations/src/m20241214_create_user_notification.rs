// FIXME: Remove this migration in the next major release.
use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum UserNotification {
    Id,
    Lot,
    Table,
    UserId,
    Message,
    CreatedOn,
    IsAddressed,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserNotification::Table)
                    .col(
                        ColumnDef::new(UserNotification::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(UserNotification::Lot).text().not_null())
                    .col(ColumnDef::new(UserNotification::Message).text().not_null())
                    .col(ColumnDef::new(UserNotification::UserId).text().not_null())
                    .col(ColumnDef::new(UserNotification::IsAddressed).boolean())
                    .col(
                        ColumnDef::new(UserNotification::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("notification_to_user_foreign_key")
                            .from(UserNotification::Table, UserNotification::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("notification__user_id__index")
                    .table(UserNotification::Table)
                    .col(UserNotification::UserId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
