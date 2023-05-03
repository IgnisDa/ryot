use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::Metadata;

pub struct Migration;

#[derive(Iden)]
enum UserToMetadata {
    Table,
    UserId,
    MetadataId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(Some(1))")]
pub enum TokenLot {
    #[sea_orm(string_value = "A")]
    ApiAccess,
    #[sea_orm(string_value = "L")]
    Login,
}

#[derive(Iden)]
enum Token {
    Table,
    Id,
    UserId,
    Lot,
    CreatedOn,
    LastUsed,
    Value,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(rs_type = "String", db_type = "String(Some(1))")]
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
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230417_000004_create_user"
    }
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
                    .col(ColumnDef::new(User::Password).string().not_null())
                    .col(ColumnDef::new(User::Lot).string_len(1).not_null())
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
                    .table(Token::Table)
                    .col(
                        ColumnDef::new(Token::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Token::Value)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(Token::Lot).string_len(1).not_null())
                    .col(ColumnDef::new(Token::UserId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user-to-token_foreign_key")
                            .from(Token::Table, Token::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(
                        ColumnDef::new(Token::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Token::LastUsed).timestamp_with_time_zone())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("token__value__index")
                    .table(Token::Table)
                    .col(Token::Value)
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
                    .primary_key(
                        Index::create()
                            .name("pk-user_metadata")
                            .col(UserToMetadata::UserId)
                            .col(UserToMetadata::MetadataId),
                    )
                    .col(
                        ColumnDef::new(Metadata::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
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

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(UserToMetadata::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Token::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(User::Table).to_owned())
            .await?;
        Ok(())
    }
}
