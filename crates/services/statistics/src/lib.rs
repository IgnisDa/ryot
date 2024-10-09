use std::{fmt::Write, sync::Arc};

use async_graphql::Result;
use database_models::{daily_user_activity, prelude::DailyUserActivity};
use database_utils::calculate_user_activities_and_summary;
use dependent_models::DailyUserActivitiesResponse;
use media_models::{
    DailyUserActivitiesInput, DailyUserActivitiesResponseGroupedBy, DailyUserActivityItem,
};
use sea_orm::{
    prelude::Expr,
    sea_query::{Alias, Func},
    ColumnTrait, EntityTrait, Iden, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};
use supporting_service::SupportingService;

pub struct StatisticsService(pub Arc<SupportingService>);

impl StatisticsService {
    pub async fn daily_user_activities(
        &self,
        user_id: &String,
        input: DailyUserActivitiesInput,
    ) -> Result<DailyUserActivitiesResponse> {
        // TODO: https://github.com/SeaQL/sea-query/pull/825 when merged
        struct DateTrunc;
        impl Iden for DateTrunc {
            fn unquoted(&self, s: &mut dyn Write) {
                write!(s, "DATE_TRUNC").unwrap();
            }
        }
        let precondition = DailyUserActivity::find()
            .filter(daily_user_activity::Column::UserId.eq(user_id))
            .apply_if(input.end_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.lte(v))
            })
            .apply_if(input.start_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.gte(v))
            })
            .select_only();
        let grouped_by = if let Some(group_by) = input.group_by {
            group_by
        } else {
            let total = precondition
                .clone()
                .expr_as(
                    daily_user_activity::Column::Date
                        .max()
                        .sub(daily_user_activity::Column::Date.min())
                        .add(1),
                    "num_days",
                )
                .into_tuple::<Option<i32>>()
                .one(&self.0.db)
                .await?;
            if let Some(Some(num_days)) = total {
                if num_days >= 500 {
                    DailyUserActivitiesResponseGroupedBy::Year
                } else if num_days >= 200 {
                    DailyUserActivitiesResponseGroupedBy::Month
                } else {
                    DailyUserActivitiesResponseGroupedBy::Day
                }
            } else {
                DailyUserActivitiesResponseGroupedBy::Day
            }
        };
        let day_alias = Expr::col(Alias::new("day"));
        let items = precondition
            .column_as(
                Expr::expr(Func::cast_as(
                    Func::cust(DateTrunc)
                        .arg(Expr::val(grouped_by.to_string()))
                        .arg(daily_user_activity::Column::Date.into_expr()),
                    Alias::new("DATE"),
                )),
                "day",
            )
            .column_as(
                daily_user_activity::Column::MetadataReviewCount.sum(),
                "total_metadata_review_count",
            )
            .column_as(
                daily_user_activity::Column::CollectionReviewCount.sum(),
                "total_collection_review_count",
            )
            .column_as(
                daily_user_activity::Column::MetadataGroupReviewCount.sum(),
                "total_metadata_group_review_count",
            )
            .column_as(
                daily_user_activity::Column::PersonReviewCount.sum(),
                "total_person_review_count",
            )
            .column_as(
                daily_user_activity::Column::MeasurementCount.sum(),
                "measurement_count",
            )
            .column_as(
                daily_user_activity::Column::WorkoutCount.sum(),
                "workout_count",
            )
            .column_as(
                daily_user_activity::Column::WorkoutDuration.sum(),
                "total_workout_duration",
            )
            .column_as(
                daily_user_activity::Column::AudioBookCount.sum(),
                "audio_book_count",
            )
            .column_as(
                daily_user_activity::Column::AudioBookDuration.sum(),
                "total_audio_book_duration",
            )
            .column_as(daily_user_activity::Column::AnimeCount.sum(), "anime_count")
            .column_as(daily_user_activity::Column::BookCount.sum(), "book_count")
            .column_as(
                daily_user_activity::Column::BookPages.sum(),
                "total_book_pages",
            )
            .column_as(
                daily_user_activity::Column::PodcastCount.sum(),
                "podcast_count",
            )
            .column_as(
                daily_user_activity::Column::PodcastDuration.sum(),
                "total_podcast_duration",
            )
            .column_as(daily_user_activity::Column::MangaCount.sum(), "manga_count")
            .column_as(daily_user_activity::Column::MovieCount.sum(), "movie_count")
            .column_as(
                daily_user_activity::Column::MovieDuration.sum(),
                "total_movie_duration",
            )
            .column_as(daily_user_activity::Column::ShowCount.sum(), "show_count")
            .column_as(
                daily_user_activity::Column::ShowDuration.sum(),
                "total_show_duration",
            )
            .column_as(
                daily_user_activity::Column::VideoGameCount.sum(),
                "video_game_count",
            )
            .column_as(
                daily_user_activity::Column::VisualNovelCount.sum(),
                "visual_novel_count",
            )
            .column_as(
                daily_user_activity::Column::VisualNovelDuration.sum(),
                "total_visual_novel_duration",
            )
            .column_as(
                daily_user_activity::Column::WorkoutPersonalBests.sum(),
                "total_workout_personal_bests",
            )
            .column_as(
                daily_user_activity::Column::WorkoutWeight.sum(),
                "total_workout_weight",
            )
            .column_as(
                daily_user_activity::Column::WorkoutReps.sum(),
                "total_workout_reps",
            )
            .column_as(
                daily_user_activity::Column::WorkoutDistance.sum(),
                "total_workout_distance",
            )
            .column_as(
                daily_user_activity::Column::WorkoutRestTime.sum(),
                "total_workout_rest_time",
            )
            .column_as(
                daily_user_activity::Column::TotalMetadataCount.sum(),
                "total_metadata_count",
            )
            .column_as(
                daily_user_activity::Column::TotalReviewCount.sum(),
                "total_review_count",
            )
            .column_as(daily_user_activity::Column::TotalCount.sum(), "total_count")
            .column_as(
                daily_user_activity::Column::TotalDuration.sum(),
                "total_duration",
            )
            .group_by(day_alias.clone())
            .order_by_asc(day_alias)
            .into_model::<DailyUserActivityItem>()
            .all(&self.0.db)
            .await
            .unwrap();
        let total_count = items.iter().map(|i| i.total_count).sum();
        let total_duration = items.iter().map(|i| i.total_duration).sum();
        let item_count = items.len();
        Ok(DailyUserActivitiesResponse {
            items,
            grouped_by,
            item_count,
            total_count,
            total_duration,
        })
    }

    pub async fn latest_user_summary(&self, user_id: &String) -> Result<DailyUserActivityItem> {
        let ls = self
            .daily_user_activities(
                user_id,
                DailyUserActivitiesInput {
                    group_by: Some(DailyUserActivitiesResponseGroupedBy::Millennium),
                    ..Default::default()
                },
            )
            .await?;
        Ok(ls.items.last().cloned().unwrap_or_default())
    }

    pub async fn calculate_user_activities_and_summary(
        &self,
        user_id: &String,
        calculate_from_beginning: bool,
    ) -> Result<()> {
        calculate_user_activities_and_summary(&self.0.db, user_id, calculate_from_beginning).await
    }
}
