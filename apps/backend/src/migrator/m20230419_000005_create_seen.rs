use sea_orm_migration::prelude::*;

use super::{m20230417_000004_create_user::User, Metadata};

pub struct Migration;

#[derive(Iden)]
pub enum Seen {
    Table,
    Id,
    Progress,
    StartedOn,
    FinishedOn,
    UserId,
    MetadataId,
    LastUpdatedOn,
    // for the time being this stores the `season` and `episode` numbers
    ExtraInformation,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230419_000005_create_seen"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Seen::Table)
                    .col(
                        ColumnDef::new(Seen::Id)
                            .primary_key()
                            .auto_increment()
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Seen::Progress)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Seen::StartedOn).date())
                    .col(ColumnDef::new(Seen::FinishedOn).date())
                    .col(ColumnDef::new(Seen::UserId).integer().not_null())
                    .col(ColumnDef::new(Seen::MetadataId).integer().not_null())
                    .col(
                        ColumnDef::new(Seen::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Seen::ExtraInformation).json())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_seen_foreign_key")
                            .from(Seen::Table, Seen::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("metadata_to_seen_foreign_key")
                            .from(Seen::Table, Seen::MetadataId)
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
            .drop_table(Table::drop().table(Seen::Table).to_owned())
            .await?;
        Ok(())
    }
}
