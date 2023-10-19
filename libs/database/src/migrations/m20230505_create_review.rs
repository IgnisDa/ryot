use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::{m20230413_create_person::Person, m20230417_create_user::User, Metadata};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static PERSON_TO_REVIEW_FOREIGN_KEY: &str = "review_to_person_foreign_key";

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum Visibility {
    #[sea_orm(string_value = "PU")]
    Public,
    #[sea_orm(string_value = "PR")]
    Private,
}

/// A review can be for either a creator or a media item.
#[derive(Iden)]
pub enum Review {
    Table,
    Id,
    PostedOn,
    Rating,
    Text,
    // for the time being this stores the `season` and `episode` numbers
    ExtraInformation,
    Visibility,
    UserId,
    MetadataId,
    PersonId,
    Spoiler,
    Comments,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Review::Table)
                    .col(
                        ColumnDef::new(Review::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Review::PostedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Review::Rating).decimal())
                    .col(ColumnDef::new(Review::Text).string())
                    .col(
                        ColumnDef::new(Review::Spoiler)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(Review::Comments).json().not_null())
                    .col(ColumnDef::new(Review::ExtraInformation).json())
                    .col(
                        ColumnDef::new(Review::Visibility)
                            .string_len(2)
                            .not_null()
                            .default(Visibility::Private),
                    )
                    .col(ColumnDef::new(Review::UserId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("review_to_user_foreign_key")
                            .from(Review::Table, Review::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Review::MetadataId).integer().null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("review_to_metadata_foreign_key")
                            .from(Review::Table, Review::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Review::PersonId).integer().null())
                    .foreign_key(
                        ForeignKey::create()
                            .name(PERSON_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::PersonId)
                            .to(Person::Table, Person::Id)
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
