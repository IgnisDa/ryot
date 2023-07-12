use sea_orm_migration::prelude::*;

use crate::migrator::{m20230417_000002_create_user::User, Metadata};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230419_000003_create_seen"
    }
}

#[derive(Iden)]
pub enum Seen {
    Table,
    Id,
    Progress,
    StartedOn,
    FinishedOn,
    // If the user abandoned this media item while consuming it
    Dropped,
    UserId,
    MetadataId,
    LastUpdatedOn,
    // for the time being this stores the `season` and `episode` numbers
    ExtraInformation,
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
                    .col(ColumnDef::new(Seen::Dropped).boolean().default(false))
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

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
