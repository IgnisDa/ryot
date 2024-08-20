use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

pub static DAILY_USER_ACTIVITY_PRIMARY_KEY: &str = "pk-daily_user_activity";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum DailyUserActivity {
    Table,
    UserId,
    Date,
    MetadataCounts,
    HourCounts,
    ReviewCounts,
    MeasurementCounts,
    WorkoutCounts,
    TotalCounts,
    TotalDuration,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DailyUserActivity::Table)
                    .col(ColumnDef::new(DailyUserActivity::Date).date().not_null())
                    .col(ColumnDef::new(DailyUserActivity::UserId).text().not_null())
                    .primary_key(
                        Index::create()
                            .name(DAILY_USER_ACTIVITY_PRIMARY_KEY)
                            .col(DailyUserActivity::Date)
                            .col(DailyUserActivity::UserId),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::MetadataCounts)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::HourCounts)
                            .json_binary()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::ReviewCounts)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::WorkoutCounts)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::MeasurementCounts)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::TotalCounts)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::TotalDuration)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("daily_user_activity_to_user_foreign_key")
                            .from(DailyUserActivity::Table, DailyUserActivity::UserId)
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
                    .name("daily_user_activity-user_id__index")
                    .table(DailyUserActivity::Table)
                    .col(DailyUserActivity::UserId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
