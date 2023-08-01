use sea_orm_migration::prelude::*;

use crate::{
    migrator::{m20230417_000002_create_user::User, m20230730_create_creator::Creator, Metadata},
    models::media::Visibility,
};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230505_000006_create_review"
    }
}

pub static CREATOR_TO_REVIEW_FOREIGN_KEY: &str = "review_to_creator_foreign_key";

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
    CreatorId,
    Spoiler,
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
                    .col(ColumnDef::new(Review::CreatorId).integer().null())
                    .foreign_key(
                        ForeignKey::create()
                            .name(CREATOR_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::CreatorId)
                            .to(Creator::Table, Creator::Id)
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
