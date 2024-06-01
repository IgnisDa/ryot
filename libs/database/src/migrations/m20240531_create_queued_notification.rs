use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum QueuedNotification {
    Table,
    Id,
    UserId,
    Message,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(QueuedNotification::Table)
                    .col(
                        ColumnDef::new(QueuedNotification::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(QueuedNotification::Message)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(QueuedNotification::UserId).text().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("queued_notification_to_user_foreign_key")
                            .from(QueuedNotification::Table, QueuedNotification::UserId)
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
                    .name("queued_notification__user_id__index")
                    .table(QueuedNotification::Table)
                    .col(QueuedNotification::UserId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
