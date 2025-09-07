use std::sync::Arc;

use anyhow::Result;
use common_models::{
    ApplicationDateRange, DailyUserActivitiesResponseGroupedBy, UserAnalyticsInput,
    UserLevelCacheKey,
};
use database_models::{daily_user_activity, prelude::DailyUserActivity};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, DailyUserActivitiesResponse,
    DailyUserActivityItem,
};
use sea_orm::{
    ColumnTrait, EntityTrait, Order, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
    prelude::{Date, Expr},
    sea_query::{Alias, Func, NullOrdering, PgFunc},
};
use supporting_service::SupportingService;

pub async fn user_analytics_parameters(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<CachedResponse<ApplicationDateRange>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserAnalyticsParameters(UserLevelCacheKey {
            input: (),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserAnalyticsParameters,
        || async {
            let get_date = |ordering: Order| {
                DailyUserActivity::find()
                    .filter(daily_user_activity::Column::UserId.eq(user_id))
                    .select_only()
                    .column(daily_user_activity::Column::Date)
                    .order_by_with_nulls(
                        daily_user_activity::Column::Date,
                        ordering,
                        NullOrdering::Last,
                    )
                    .into_tuple::<Date>()
                    .one(&ss.db)
            };
            let start_date = get_date(Order::Asc).await?;
            let end_date = get_date(Order::Desc).await?;
            let response = ApplicationDateRange {
                end_date,
                start_date,
            };
            Ok(response)
        },
    )
    .await
}

pub async fn get_daily_user_activities(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: UserAnalyticsInput,
) -> Result<DailyUserActivitiesResponse> {
    let precondition = DailyUserActivity::find()
        .filter(daily_user_activity::Column::UserId.eq(user_id))
        .apply_if(input.date_range.end_date, |query, v| {
            query.filter(daily_user_activity::Column::Date.lte(v))
        })
        .apply_if(input.date_range.start_date, |query, v| {
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
            .one(&ss.db)
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
    let date_type = Alias::new("DATE");
    let default_date = Expr::val("2001-01-01");
    let items = precondition
        .column_as(
            Expr::expr(Func::cast_as(
                match grouped_by {
                    DailyUserActivitiesResponseGroupedBy::AllTime => default_date,
                    _ => Expr::expr(PgFunc::date_trunc(
                        grouped_by.into(),
                        Func::coalesce([
                            Expr::col(daily_user_activity::Column::Date).into(),
                            Func::cast_as(default_date, date_type.clone()).into(),
                        ]),
                    )),
                },
                date_type,
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
            "user_measurement_count",
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
        .column_as(daily_user_activity::Column::MusicCount.sum(), "music_count")
        .column_as(
            daily_user_activity::Column::MusicDuration.sum(),
            "total_music_duration",
        )
        .column_as(daily_user_activity::Column::ShowCount.sum(), "show_count")
        .column_as(
            daily_user_activity::Column::ShowDuration.sum(),
            "total_show_duration",
        )
        .column_as(
            daily_user_activity::Column::VideoGameDuration.sum(),
            "total_video_game_duration",
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
        .all(&ss.db)
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
