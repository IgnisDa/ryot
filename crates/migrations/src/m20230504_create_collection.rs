use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Collection {
    Table,
    Id,
    CreatedOn,
    LastUpdatedOn,
    Name,
    UserId,
    Description,
    InformationTemplate,
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
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Collection::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Collection::Name).text().not_null())
                    .col(ColumnDef::new(Collection::Description).text())
                    .col(
                        ColumnDef::new(Collection::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Collection::InformationTemplate).json_binary())
                    .col(ColumnDef::new(Collection::UserId).text().not_null())
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
                    .unique()
                    .name("collection__name-user_id__index")
                    .table(Collection::Table)
                    .col(Collection::Name)
                    .col(Collection::UserId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
