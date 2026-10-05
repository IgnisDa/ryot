use sea_orm_migration::prelude::*;

use super::{m20230404_create_user::User, m20230410_create_metadata::Metadata};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
enum PersonalNote {
    Table,
    UserId,
    MetadataId,
    Text,
    CreatedAt,
    UpdatedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(PersonalNote::Table)
                    .col(ColumnDef::new(PersonalNote::UserId).text().not_null())
                    .col(ColumnDef::new(PersonalNote::MetadataId).text().not_null())
                    .col(ColumnDef::new(PersonalNote::Text).text().not_null())
                    .col(
                        ColumnDef::new(PersonalNote::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(PersonalNote::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .primary_key(
                        Index::create()
                            .col(PersonalNote::UserId)
                            .col(PersonalNote::MetadataId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("personal_note_user_fk")
                            .from(PersonalNote::Table, PersonalNote::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("personal_note_metadata_fk")
                            .from(PersonalNote::Table, PersonalNote::MetadataId)
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
