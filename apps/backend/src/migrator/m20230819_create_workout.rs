use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Workout {
    Table,
    Id,
    /// Whether this workout has its records (PRs) calculated.
    Processed,
    UserId,
    Name,
    Comment,
    StartTime,
    EndTime,
    /// General information like total weights lifted, number of records etc.
    Summary,
    /// Actual exercises performed, supersets, etc.
    Information,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Workout::Table)
                    .col(
                        ColumnDef::new(Workout::Id)
                            .primary_key()
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Workout::Processed)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(Workout::StartTime)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Workout::EndTime)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Workout::UserId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("workout_to_user_foreign_key")
                            .from(Workout::Table, Workout::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Workout::Summary).json().not_null())
                    .col(ColumnDef::new(Workout::Information).json().not_null())
                    .col(ColumnDef::new(Workout::Name).string().null())
                    .col(ColumnDef::new(Workout::Comment).string().null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("workout__start-time__index")
                    .table(Workout::Table)
                    .col(Workout::StartTime)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
