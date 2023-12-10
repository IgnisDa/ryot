use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum UserLot {
    #[sea_orm(string_value = "A")]
    Admin,
    #[sea_orm(string_value = "N")]
    Normal,
}

#[derive(Iden)]
pub enum User {
    Table,
    Id,
    Name,
    Password,
    Lot,
    Email,
    Preferences,
    // This field can be `NULL` if the user has not enabled any yank integration
    YankIntegrations,
    // This field can be `NULL` if the user has not enabled any sink integration
    SinkIntegrations,
    Notifications,
    Summary,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(User::Table)
                    .col(
                        ColumnDef::new(User::Id)
                            .primary_key()
                            .auto_increment()
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(User::Name).unique_key().string().not_null())
                    .col(ColumnDef::new(User::Email).unique_key().string())
                    .col(ColumnDef::new(User::Password).string().not_null())
                    .col(ColumnDef::new(User::Lot).string_len(1).not_null())
                    .col(ColumnDef::new(User::Preferences).json_binary().not_null())
                    .col(ColumnDef::new(User::YankIntegrations).json_binary())
                    .col(ColumnDef::new(User::SinkIntegrations).json_binary())
                    .col(ColumnDef::new(User::Notifications).json_binary())
                    .col(ColumnDef::new(User::Summary).json_binary())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("user__name__index")
                    .table(User::Table)
                    .col(User::Name)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
