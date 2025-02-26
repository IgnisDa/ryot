use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum NotificationPlatform {
    Id,
    Lot,
    Table,
    UserId,
    CreatedOn,
    IsDisabled,
    Description,
    ConfiguredEvents,
    PlatformSpecifics,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(NotificationPlatform::Table)
                    .col(
                        ColumnDef::new(NotificationPlatform::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(NotificationPlatform::Lot).text().not_null())
                    .col(
                        ColumnDef::new(NotificationPlatform::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(NotificationPlatform::PlatformSpecifics)
                            .json_binary()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(NotificationPlatform::Description)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(NotificationPlatform::UserId)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(NotificationPlatform::IsDisabled).boolean())
                    .col(
                        ColumnDef::new(NotificationPlatform::ConfiguredEvents)
                            .array(ColumnType::Text)
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("notification_platform_to_user_foreign_key")
                            .from(NotificationPlatform::Table, NotificationPlatform::UserId)
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
                    .name("notification_platform__user_id")
                    .table(NotificationPlatform::Table)
                    .col(NotificationPlatform::UserId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
