use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

pub static DAILY_USER_ACTIVITY_PRIMARY_KEY: &str = "pk-daily_user_activity";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum DailyUserActivity2 {
    Table,
    UserId,
    Date,
    MetadataCounts,
    HourCounts,
    ReviewCounts,
    MeasurementCounts,
    WorkoutCounts,
    TotalCounts,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DailyUserActivity2::Table)
                    .col(ColumnDef::new(DailyUserActivity2::UserId).text().not_null())
                    .col(ColumnDef::new(DailyUserActivity2::Date).date().not_null())
                    .primary_key(
                        Index::create()
                            .name(DAILY_USER_ACTIVITY_PRIMARY_KEY)
                            .col(DailyUserActivity2::UserId)
                            .col(DailyUserActivity2::Date),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity2::MetadataCounts)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity2::HourCounts)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity2::ReviewCounts)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity2::WorkoutCounts)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity2::MeasurementCounts)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity2::TotalCounts)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("daily_user_activity_to_user_foreign_key")
                            .from(DailyUserActivity2::Table, DailyUserActivity2::UserId)
                            .to(User::Table, User::Id)
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
