use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Integration {
    Id,
    Lot,
    Name,
    Table,
    UserId,
    Provider,
    CreatedOn,
    IsDisabled,
    ExtraSettings,
    TriggerResult,
    LastFinishedAt,
    MinimumProgress,
    MaximumProgress,
    ProviderSpecifics,
    SyncToOwnedCollection,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Integration::Table)
                    .col(
                        ColumnDef::new(Integration::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Integration::Lot).text().not_null())
                    .col(ColumnDef::new(Integration::Provider).text().not_null())
                    .col(
                        ColumnDef::new(Integration::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Integration::ProviderSpecifics).json_binary())
                    .col(ColumnDef::new(Integration::UserId).text().not_null())
                    .col(ColumnDef::new(Integration::SyncToOwnedCollection).boolean())
                    .col(ColumnDef::new(Integration::MinimumProgress).decimal())
                    .col(ColumnDef::new(Integration::MaximumProgress).decimal())
                    .col(ColumnDef::new(Integration::IsDisabled).boolean())
                    .col(ColumnDef::new(Integration::Name).text())
                    .col(
                        ColumnDef::new(Integration::TriggerResult)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .col(ColumnDef::new(Integration::LastFinishedAt).timestamp_with_time_zone())
                    .col(
                        ColumnDef::new(Integration::ExtraSettings)
                            .json_binary()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("integration_to_user_foreign_key")
                            .from(Integration::Table, Integration::UserId)
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
                    .name("integration__lot")
                    .table(Integration::Table)
                    .col(Integration::Lot)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("integration__user_id")
                    .table(Integration::Table)
                    .col(Integration::UserId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
