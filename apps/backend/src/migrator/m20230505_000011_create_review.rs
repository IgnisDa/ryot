use sea_orm_migration::prelude::*;

use super::{get_integer_col, m20230417_000004_create_user::User, Metadata};

pub struct Migration;

#[derive(Iden)]
pub enum Review {
    Table,
    Id,
    UserId,
    MetadataId,
    PostedOn,
    Rating,
    Text,
    // for the time being this stores the `season` and `episode` numbers
    ExtraInformation,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230505_000011_create_review"
    }
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
                    .col(&mut get_integer_col(Review::Rating))
                    .col(ColumnDef::new(Review::Text).string())
                    .col(ColumnDef::new(Review::ExtraInformation).json())
                    .col(ColumnDef::new(Review::UserId).integer().not_null())
                    .col(ColumnDef::new(Review::MetadataId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("review_to_user_foreign_key")
                            .from(Review::Table, Review::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("review_to_metadata_foreign_key")
                            .from(Review::Table, Review::MetadataId)
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
            .drop_table(Table::drop().table(Review::Table).to_owned())
            .await?;
        Ok(())
    }
}
