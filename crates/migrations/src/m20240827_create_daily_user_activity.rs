use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

pub static DAILY_USER_ACTIVITY_PRIMARY_KEY: &str = "pk-daily_user_activity";
pub static DAILY_USER_ACTIVITY_TOTAL_COUNTS_GENERATED_SQL: &str = r#"
GENERATED ALWAYS AS (
    "review_count" + "measurement_count" + "workout_count" + "audio_book_count" +
    "anime_count" + "book_count" + "podcast_count" + "manga_count" + "movie_count" +
    "show_count" + "video_game_count" + "visual_novel_count"
) STORED
"#;
pub static DAILY_USER_ACTIVITY_TOTAL_DURATION_GENERATED_SQL: &str = r#"
GENERATED ALWAYS AS (
    "workout_duration" + "audio_book_duration" + "podcast_duration" +
    "movie_duration" +"show_duration"
) STORED
"#;

fn integer_not_null<T: IntoIden>(col: T) -> ColumnDef {
    ColumnDef::new(col).integer().not_null().default(0).take()
}

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum DailyUserActivity {
    Table,
    UserId,
    Date,
    ReviewCount,
    MeasurementCount,
    WorkoutCount,
    WorkoutDuration,
    AudioBookCount,
    AudioBookDuration,
    AnimeCount,
    BookCount,
    PodcastCount,
    PodcastDuration,
    MangaCount,
    MovieCount,
    MovieDuration,
    ShowCount,
    ShowDuration,
    VideoGameCount,
    VisualNovelCount,
    TotalCount,
    /// DEV: in minutes
    TotalDuration,
    MostActiveHour,
    LeastActiveHour,
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
                    .col(integer_not_null(DailyUserActivity::ReviewCount))
                    .col(integer_not_null(DailyUserActivity::WorkoutCount))
                    .col(integer_not_null(DailyUserActivity::WorkoutDuration))
                    .col(integer_not_null(DailyUserActivity::MeasurementCount))
                    .col(integer_not_null(DailyUserActivity::AudioBookCount))
                    .col(integer_not_null(DailyUserActivity::AudioBookDuration))
                    .col(integer_not_null(DailyUserActivity::AnimeCount))
                    .col(integer_not_null(DailyUserActivity::BookCount))
                    .col(integer_not_null(DailyUserActivity::PodcastCount))
                    .col(integer_not_null(DailyUserActivity::PodcastDuration))
                    .col(integer_not_null(DailyUserActivity::MangaCount))
                    .col(integer_not_null(DailyUserActivity::MovieCount))
                    .col(integer_not_null(DailyUserActivity::MovieDuration))
                    .col(integer_not_null(DailyUserActivity::ShowCount))
                    .col(integer_not_null(DailyUserActivity::ShowDuration))
                    .col(integer_not_null(DailyUserActivity::VideoGameCount))
                    .col(integer_not_null(DailyUserActivity::VisualNovelCount))
                    .col(
                        ColumnDef::new(DailyUserActivity::TotalCount)
                            .integer()
                            .not_null()
                            .extra(DAILY_USER_ACTIVITY_TOTAL_COUNTS_GENERATED_SQL),
                    )
                    .col(
                        ColumnDef::new(DailyUserActivity::TotalDuration)
                            .integer()
                            .not_null()
                            .extra(DAILY_USER_ACTIVITY_TOTAL_DURATION_GENERATED_SQL),
                    )
                    .col(ColumnDef::new(DailyUserActivity::MostActiveHour).integer())
                    .col(ColumnDef::new(DailyUserActivity::LeastActiveHour).integer())
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
