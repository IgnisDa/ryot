// FIXME: Delete this migration
use sea_orm_migration::prelude::*;

use super::{m20230417_create_user::User, m20230504_create_collection::Collection};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum UserToCollection {
    Table,
    CollectionId,
    UserId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(UserToCollection::Table)
                    .col(
                        ColumnDef::new(UserToCollection::CollectionId)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(UserToCollection::UserId).text())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_collection-fk1")
                            .from(UserToCollection::Table, UserToCollection::CollectionId)
                            .to(Collection::Table, Collection::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_collection-fk2")
                            .from(UserToCollection::Table, UserToCollection::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-user_to_collection")
                            .col(UserToCollection::UserId)
                            .col(UserToCollection::CollectionId),
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
