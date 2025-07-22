// FIXME: Remove this migration in the next major release.
use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

fn integer_not_null<T: IntoIden>(col: T) -> ColumnDef {
    ColumnDef::new(col).integer().not_null().default(0).take()
}

pub static DAILY_USER_ACTIVITY_COMPOSITE_UNIQUE_KEY: &str = "daily_user_activity_uqi1";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum DailyUserActivity {
    Table,
    UserId,
    Id,
    Date,
    EntityIds,
    MetadataReviewCount,
    CollectionReviewCount,
    MetadataGroupReviewCount,
    TotalMetadataGroupCount,
    TotalPersonCount,
    PersonReviewCount,
    PersonCollectionCount,
    MetadataCollectionCount,
    MetadataGroupCollectionCount,
    TotalCollectionCount,
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
    MusicCount,
    MusicDuration,
    ShowCount,
    ShowDuration,
    VideoGameCount,
    VideoGameDuration,
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
    HourRecords,
    WorkoutMuscles,
    WorkoutExercises,
    WorkoutEquipments,
    WorkoutCaloriesBurnt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DailyUserActivity::Table)
                    .col(
                        ColumnDef::new(DailyUserActivity::Id)
                            .uuid()
                            .not_null()
                            .default(PgFunc::gen_random_uuid())
                            .primary_key(),
                    )
                    .col(ColumnDef::new(DailyUserActivity::Date).date())
                    .col(ColumnDef::new(DailyUserActivity::UserId).text().not_null())
                    .col(
                        ColumnDef::new(DailyUserActivity::EntityIds)
                            .array(ColumnType::Text)
                            .not_null()
                            .default(Expr::cust("'{}'")),
                    )
                    .col(integer_not_null(DailyUserActivity::MetadataReviewCount))
                    .col(integer_not_null(DailyUserActivity::CollectionReviewCount))
                    .col(integer_not_null(
                        DailyUserActivity::MetadataGroupReviewCount,
                    ))
                    .col(integer_not_null(DailyUserActivity::TotalMetadataGroupCount))
                    .col(integer_not_null(DailyUserActivity::TotalPersonCount))
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
                    .col(integer_not_null(DailyUserActivity::MusicCount))
                    .col(integer_not_null(DailyUserActivity::MusicDuration))
                    .col(integer_not_null(DailyUserActivity::ShowCount))
                    .col(integer_not_null(DailyUserActivity::ShowDuration))
                    .col(integer_not_null(DailyUserActivity::VideoGameCount))
                    .col(integer_not_null(DailyUserActivity::VideoGameDuration))
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
                    .col(integer_not_null(DailyUserActivity::WorkoutCaloriesBurnt))
                    .col(integer_not_null(DailyUserActivity::PersonCollectionCount))
                    .col(integer_not_null(DailyUserActivity::MetadataCollectionCount))
                    .col(integer_not_null(
                        DailyUserActivity::MetadataGroupCollectionCount,
                    ))
                    .col(integer_not_null(DailyUserActivity::TotalCollectionCount))
                    .col(
                        ColumnDef::new(DailyUserActivity::HourRecords)
                            .json_binary()
                            .not_null()
                            .default(Expr::cust("'[]'")),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::WorkoutMuscles)
                            .array(ColumnType::Text)
                            .not_null()
                            .default(Expr::cust("'{}'")),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::WorkoutExercises)
                            .array(ColumnType::Text)
                            .not_null()
                            .default(Expr::cust("'{}'")),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::WorkoutEquipments)
                            .array(ColumnType::Text)
                            .not_null()
                            .default(Expr::cust("'{}'")),
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
                    .name(DAILY_USER_ACTIVITY_COMPOSITE_UNIQUE_KEY)
                    .unique()
                    .nulls_not_distinct()
                    .table(DailyUserActivity::Table)
                    .col(DailyUserActivity::UserId)
                    .col(DailyUserActivity::Date)
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
