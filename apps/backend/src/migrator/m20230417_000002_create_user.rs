use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use crate::migrator::Metadata;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230417_000002_create_user"
    }
}

/// This exists if a media item is related to a user. A media is related to a
/// user if:
/// - the user has it in their seen history
/// - added it to a collection
/// - has reviewed it
/// - added to their monitored media
/// - added a reminder
#[derive(Iden)]
pub enum UserToMetadata {
    Table,
    UserId,
    MetadataId,
    LastUpdatedOn,
    Monitored,
    Reminder,
}

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
                    .col(ColumnDef::new(User::Preferences).json().not_null())
                    .col(ColumnDef::new(User::YankIntegrations).json())
                    .col(ColumnDef::new(User::SinkIntegrations).json())
                    .col(ColumnDef::new(User::Notifications).json())
                    .col(ColumnDef::new(User::Summary).json())
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
        manager
            .create_table(
                Table::create()
                    .table(UserToMetadata::Table)
                    .col(ColumnDef::new(UserToMetadata::UserId).integer().not_null())
                    .col(
                        ColumnDef::new(UserToMetadata::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(UserToMetadata::Monitored)
                            .boolean()
                            .default(false)
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-user_metadata")
                            .col(UserToMetadata::UserId)
                            .col(UserToMetadata::MetadataId),
                    )
                    .col(
                        ColumnDef::new(UserToMetadata::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(UserToMetadata::Reminder).json().null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-user_metadata-user_id")
                            .from(UserToMetadata::Table, UserToMetadata::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-user_metadata-metadata_id")
                            .from(UserToMetadata::Table, UserToMetadata::UserId)
                            .to(Metadata::Table, Metadata::Id)
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
