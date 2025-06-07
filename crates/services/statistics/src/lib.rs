use std::{cmp::Reverse, sync::Arc};

use async_graphql::Result;
use common_models::{
    ApplicationDateRange, DailyUserActivitiesResponseGroupedBy, DailyUserActivityHourRecord,
    UserAnalyticsInput, UserLevelCacheKey,
};
use database_models::{daily_user_activity, prelude::DailyUserActivity};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, DailyUserActivitiesResponse, DailyUserActivityItem,
    FitnessAnalyticsEquipment, FitnessAnalyticsExercise, FitnessAnalyticsMuscle, UserAnalytics,
    UserFitnessAnalytics,
};
use dependent_utils::calculate_user_activities_and_summary;
use enum_models::{ExerciseEquipment, ExerciseMuscle};
use hashbag::HashBag;
use itertools::Itertools;
use sea_orm::{
    ColumnTrait, DerivePartialModel, EntityTrait, FromQueryResult, Order, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait,
    prelude::{Date, Expr},
    sea_query::{Alias, Func, NullOrdering, PgFunc},
};
use supporting_service::SupportingService;

pub struct StatisticsService(pub Arc<SupportingService>);

impl StatisticsService {
    pub async fn calculate_user_activities_and_summary(
        &self,
        user_id: &String,
        calculate_from_beginning: bool,
    ) -> Result<()> {
        calculate_user_activities_and_summary(user_id, &self.0, calculate_from_beginning).await
    }

    pub async fn user_analytics_parameters(
        &self,
        user_id: &String,
    ) -> Result<ApplicationDateRange> {
        let cc = &self.0.cache_service;
        let cache_key = ApplicationCacheKey::UserAnalyticsParameters(UserLevelCacheKey {
            input: (),
            user_id: user_id.to_owned(),
        });
        if let Some((_id, cached)) = cc.get_value(cache_key.clone()).await {
            return Ok(cached);
        }
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
                .one(&self.0.db)
        };
        let start_date = get_date(Order::Asc).await?;
        let end_date = get_date(Order::Desc).await?;
        let response = ApplicationDateRange {
            end_date,
            start_date,
        };
        cc.set_key(
            cache_key,
            ApplicationCacheValue::UserAnalyticsParameters(response.clone()),
        )
        .await?;
        Ok(response)
    }

    async fn daily_user_activities(
        &self,
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

    pub async fn user_analytics(
        &self,
        user_id: &String,
        input: UserAnalyticsInput,
    ) -> Result<UserAnalytics> {
        let cache_key = ApplicationCacheKey::UserAnalytics(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        });
        let cc = &self.0.cache_service;
        if let Some((_id, cached)) = cc.get_value::<UserAnalytics>(cache_key.clone()).await {
            return Ok(cached);
        }
        #[derive(Debug, DerivePartialModel, FromQueryResult)]
        #[sea_orm(entity = "DailyUserActivity")]
        pub struct CustomFitnessAnalytics {
            pub workout_reps: i32,
            pub workout_count: i32,
            pub workout_weight: i32,
            pub workout_duration: i32,
            pub workout_distance: i32,
            pub workout_rest_time: i32,
            pub measurement_count: i32,
            pub workout_personal_bests: i32,
            pub workout_calories_burnt: i32,
            pub workout_exercises: Vec<String>,
            pub workout_muscles: Vec<ExerciseMuscle>,
            pub workout_equipments: Vec<ExerciseEquipment>,
            pub hour_records: Vec<DailyUserActivityHourRecord>,
        }
        let items = DailyUserActivity::find()
            .filter(daily_user_activity::Column::UserId.eq(user_id))
            .apply_if(input.date_range.start_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.gte(v))
            })
            .apply_if(input.date_range.end_date, |query, v| {
                query.filter(daily_user_activity::Column::Date.lte(v))
            })
            .into_partial_model::<CustomFitnessAnalytics>()
            .all(&self.0.db)
            .await?;
        let mut hours: Vec<DailyUserActivityHourRecord> = vec![];
        items.iter().for_each(|item| {
            for hour in item.hour_records.clone() {
                let index = hours.iter().position(|h| h.hour == hour.hour);
                if let Some(index) = index {
                    hours.get_mut(index).unwrap().entities.extend(hour.entities);
                } else {
                    hours.push(hour);
                }
            }
        });
        let workout_reps = items.iter().map(|i| i.workout_reps).sum();
        let workout_count = items.iter().map(|i| i.workout_count).sum();
        let workout_weight = items.iter().map(|i| i.workout_weight).sum();
        let workout_distance = items.iter().map(|i| i.workout_distance).sum();
        let workout_duration = items.iter().map(|i| i.workout_duration).sum();
        let workout_rest_time = items.iter().map(|i| i.workout_rest_time).sum();
        let measurement_count = items.iter().map(|i| i.measurement_count).sum();
        let workout_calories_burnt = items.iter().map(|i| i.workout_calories_burnt).sum();
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
        let activities = self.daily_user_activities(user_id, input).await?;
        let response = UserAnalytics {
            hours,
            activities,
            fitness: UserFitnessAnalytics {
                workout_reps,
                workout_count,
                workout_weight,
                workout_muscles,
                workout_distance,
                workout_duration,
                workout_rest_time,
                workout_exercises,
                measurement_count,
                workout_equipments,
                workout_personal_bests,
                workout_calories_burnt,
            },
        };
        cc.set_key(
            cache_key,
            ApplicationCacheValue::UserAnalytics(response.clone()),
        )
        .await?;
        Ok(response)
    }
}
