// FIXME: Rename this to m20230505_create_exercise in the next major release
use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Exercise {
    Table,
    Id,
    Lot,
    Force,
    Level,
    Mechanic,
    Equipment,
    Muscles,
    Identifier,
    Attributes,
    Source,
    CreatedByUserId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Exercise::Table)
                    .col(ColumnDef::new(Exercise::Id).primary_key().text().not_null())
                    .col(ColumnDef::new(Exercise::Muscles).json_binary().not_null())
                    .col(ColumnDef::new(Exercise::Lot).text().not_null())
                    .col(ColumnDef::new(Exercise::Level).text().not_null())
                    .col(ColumnDef::new(Exercise::Force).text())
                    .col(ColumnDef::new(Exercise::Mechanic).text())
                    .col(ColumnDef::new(Exercise::Equipment).text())
                    .col(ColumnDef::new(Exercise::Identifier).text())
                    .col(
                        ColumnDef::new(Exercise::Attributes)
                            .json_binary()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Exercise::Source).text().not_null())
                    .col(ColumnDef::new(Exercise::CreatedByUserId).text())
                    .foreign_key(
                        ForeignKey::create()
                            .name("workout_to_user_foreign_key")
                            .from(Exercise::Table, Exercise::CreatedByUserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::SetNull)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("exercise__identifier__index")
                    .table(Exercise::Table)
                    .col(Exercise::Identifier)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
