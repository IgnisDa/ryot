use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

fn integer_not_null<T: IntoIden>(col: T) -> ColumnDef {
    ColumnDef::new(col).integer().not_null().default(0).take()
}

pub static DAILY_USER_ACTIVITY_PRIMARY_KEY: &str = "pk-daily_user_activity";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum DailyUserActivity {
    Table,
    UserId,
    Date,
    MetadataReviewCount,
    CollectionReviewCount,
    MetadataGroupReviewCount,
    PersonReviewCount,
    ExerciseReviewCount,
    MeasurementCount,
    WorkoutCount,
    /// DEV: all durations are in minutes
    WorkoutDuration,
    AudioBookCount,
    AudioBookDuration,
    AnimeCount,
    BookCount,
    BookPages,
    PodcastCount,
    PodcastDuration,
    MangaCount,
    MovieCount,
    MovieDuration,
    ShowCount,
    ShowDuration,
    VideoGameCount,
    VisualNovelCount,
    VisualNovelDuration,
    WorkoutPersonalBests,
    WorkoutWeight,
    WorkoutReps,
    WorkoutDistance,
    WorkoutRestTime,
    TotalMetadataCount,
    TotalReviewCount,
    TotalCount,
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
                    .col(integer_not_null(DailyUserActivity::MetadataReviewCount))
                    .col(integer_not_null(DailyUserActivity::CollectionReviewCount))
                    .col(integer_not_null(
                        DailyUserActivity::MetadataGroupReviewCount,
                    ))
                    .col(integer_not_null(DailyUserActivity::PersonReviewCount))
                    .col(integer_not_null(DailyUserActivity::ExerciseReviewCount))
                    .col(integer_not_null(DailyUserActivity::WorkoutCount))
                    .col(integer_not_null(DailyUserActivity::WorkoutDuration))
                    .col(integer_not_null(DailyUserActivity::MeasurementCount))
                    .col(integer_not_null(DailyUserActivity::AudioBookCount))
                    .col(integer_not_null(DailyUserActivity::AudioBookDuration))
                    .col(integer_not_null(DailyUserActivity::AnimeCount))
                    .col(integer_not_null(DailyUserActivity::BookCount))
                    .col(integer_not_null(DailyUserActivity::BookPages))
                    .col(integer_not_null(DailyUserActivity::PodcastCount))
                    .col(integer_not_null(DailyUserActivity::PodcastDuration))
                    .col(integer_not_null(DailyUserActivity::MangaCount))
                    .col(integer_not_null(DailyUserActivity::MovieCount))
                    .col(integer_not_null(DailyUserActivity::MovieDuration))
                    .col(integer_not_null(DailyUserActivity::ShowCount))
                    .col(integer_not_null(DailyUserActivity::ShowDuration))
                    .col(integer_not_null(DailyUserActivity::VideoGameCount))
                    .col(integer_not_null(DailyUserActivity::VisualNovelCount))
                    .col(integer_not_null(DailyUserActivity::VisualNovelDuration))
                    .col(integer_not_null(DailyUserActivity::WorkoutPersonalBests))
                    .col(integer_not_null(DailyUserActivity::WorkoutWeight))
                    .col(integer_not_null(DailyUserActivity::WorkoutReps))
                    .col(integer_not_null(DailyUserActivity::WorkoutDistance))
                    .col(integer_not_null(DailyUserActivity::WorkoutRestTime))
                    .col(integer_not_null(DailyUserActivity::TotalMetadataCount))
                    .col(integer_not_null(DailyUserActivity::TotalReviewCount))
                    .col(integer_not_null(DailyUserActivity::TotalCount))
                    .col(integer_not_null(DailyUserActivity::TotalDuration))
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
