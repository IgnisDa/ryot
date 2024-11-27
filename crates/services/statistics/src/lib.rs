use std::{cmp::Reverse, fmt::Write, sync::Arc};

use async_graphql::Result;
use common_models::{
    ApplicationCacheKey, ApplicationCacheValue, DailyUserActivityHourRecord, DateRangeInput,
    FitnessAnalytics, FitnessAnalyticsEquipment, FitnessAnalyticsExercise, FitnessAnalyticsHour,
    FitnessAnalyticsMuscle,
};
use database_models::{daily_user_activity, prelude::DailyUserActivity};
use database_utils::calculate_user_activities_and_summary;
use dependent_models::DailyUserActivitiesResponse;
use enums::{EntityLot, ExerciseEquipment, ExerciseMuscle};
use hashbag::HashBag;
use itertools::Itertools;
use media_models::{
    DailyUserActivitiesInput, DailyUserActivitiesResponseGroupedBy, DailyUserActivityItem,
};
use sea_orm::{
    prelude::Expr,
    sea_query::{Alias, Func},
    ColumnTrait, DerivePartialModel, EntityTrait, FromQueryResult, Iden, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait,
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

    pub async fn fitness_analytics(
        &self,
        user_id: &String,
        input: DateRangeInput,
    ) -> Result<FitnessAnalytics> {
        let cache_key = ApplicationCacheKey::FitnessAnalytics {
            date_range: input.clone(),
            user_id: user_id.to_owned(),
        };
        if let Some(ApplicationCacheValue::FitnessAnalytics(cached)) =
            self.0.cache_service.get_key(cache_key.clone()).await?
        {
            return Ok(cached);
        }
        #[derive(Debug, DerivePartialModel, FromQueryResult)]
        #[sea_orm(entity = "DailyUserActivity")]
        pub struct CustomFitnessAnalytics {
            pub workout_reps: i32,
            pub workout_count: i32,
            pub workout_weight: i32,
            pub workout_distance: i32,
            pub workout_rest_time: i32,
            pub measurement_count: i32,
            pub workout_personal_bests: i32,
            pub workout_exercises: Vec<String>,
            pub workout_muscles: Vec<ExerciseMuscle>,
            pub workout_equipments: Vec<ExerciseEquipment>,
            pub hour_records: Vec<DailyUserActivityHourRecord>,
        }
        let items = DailyUserActivity::find()
            .filter(daily_user_activity::Column::UserId.eq(user_id))
            .apply_if(input.start_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.gte(v))
            })
            .apply_if(input.end_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.lte(v))
            })
            .into_partial_model::<CustomFitnessAnalytics>()
            .all(&self.0.db)
            .await?;
        let mut hours_bag = HashBag::new();
        items.iter().for_each(|i| {
            for record in i.hour_records.iter() {
                for entity in record.entities.iter() {
                    if entity.entity_lot == EntityLot::Workout {
                        hours_bag.insert(record.hour);
                    }
                }
            }
        });
        let hours = hours_bag
            .into_iter()
            .map(|(hour, count)| FitnessAnalyticsHour {
                hour,
                count: count.try_into().unwrap(),
            })
            .sorted_by_key(|f| Reverse(f.count))
            .collect_vec();
        let workout_reps = items.iter().map(|i| i.workout_reps).sum();
        let workout_count = items.iter().map(|i| i.workout_count).sum();
        let workout_weight = items.iter().map(|i| i.workout_weight).sum();
        let workout_distance = items.iter().map(|i| i.workout_distance).sum();
        let workout_rest_time = items.iter().map(|i| i.workout_rest_time).sum();
        let measurement_count = items.iter().map(|i| i.measurement_count).sum();
        let workout_personal_bests = items.iter().map(|i| i.workout_personal_bests).sum();
        let workout_muscles = items
            .iter()
            .flat_map(|i| i.workout_muscles.clone())
            .collect::<HashBag<ExerciseMuscle>>()
            .into_iter()
            .map(|(muscle, count)| FitnessAnalyticsMuscle {
                muscle,
                count: count.try_into().unwrap(),
            })
            .sorted_by_key(|f| Reverse(f.count))
            .collect_vec();
        let workout_exercises = items
            .iter()
            .flat_map(|i| i.workout_exercises.clone())
            .collect::<HashBag<String>>()
            .into_iter()
            .map(|(exercise_id, count)| FitnessAnalyticsExercise {
                exercise: exercise_id,
                count: count.try_into().unwrap(),
            })
            .sorted_by_key(|f| Reverse(f.count))
            .collect_vec();
        let workout_equipments = items
            .iter()
            .flat_map(|i| i.workout_equipments.clone())
            .collect::<HashBag<ExerciseEquipment>>()
            .into_iter()
            .map(|(equipment, count)| FitnessAnalyticsEquipment {
                equipment,
                count: count.try_into().unwrap(),
            })
            .sorted_by_key(|f| Reverse(f.count))
            .collect_vec();
        let response = FitnessAnalytics {
            hours,
            workout_reps,
            workout_count,
            workout_weight,
            workout_muscles,
            workout_distance,
            workout_rest_time,
            workout_exercises,
            measurement_count,
            workout_equipments,
            workout_personal_bests,
        };
        self.0
            .cache_service
            .set_with_expiry(
                cache_key,
                2,
                Some(ApplicationCacheValue::FitnessAnalytics(response.clone())),
            )
            .await?;
        Ok(response)
    }
}
