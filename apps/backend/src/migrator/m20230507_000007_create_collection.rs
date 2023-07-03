use sea_orm_migration::prelude::*;

use crate::migrator::{m20230417_000002_create_user::User, Metadata};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230507_000007_create_collection"
    }
}

#[derive(Iden)]
pub enum MetadataToCollection {
    Table,
    MetadataId,
    CollectionId,
}

#[derive(Iden)]
pub enum Collection {
    Table,
    Id,
    CreatedOn,
    Name,
    UserId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Collection::Table)
                    .col(
                        ColumnDef::new(Collection::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Collection::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Collection::Name).string().not_null())
                    .col(ColumnDef::new(Collection::UserId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_user_foreign_key")
                            .from(Collection::Table, Collection::UserId)
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
                    .name("collection__name__index")
                    .table(Collection::Table)
                    .col(Collection::Name)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("collection__name-user_id__index")
                    .table(Collection::Table)
                    .col(Collection::Name)
                    .col(Collection::UserId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataToCollection::Table)
                    .col(
                        ColumnDef::new(MetadataToCollection::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToCollection::CollectionId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-metadata_collection")
                            .col(MetadataToCollection::MetadataId)
                            .col(MetadataToCollection::CollectionId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata_id-collection_id")
                            .from(
                                MetadataToCollection::Table,
                                MetadataToCollection::MetadataId,
                            )
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-collection_id-metadata_id")
                            .from(
                                MetadataToCollection::Table,
                                MetadataToCollection::CollectionId,
                            )
                            .to(Collection::Table, Collection::Id)
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
