use std::{cmp::Reverse, sync::Arc};

use anyhow::Result;
use common_models::{DailyUserActivityHourRecord, UserAnalyticsInput, UserLevelCacheKey};
use database_models::{daily_user_activity, prelude::DailyUserActivity};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, FitnessAnalyticsEquipment,
    FitnessAnalyticsExercise, FitnessAnalyticsMuscle, UserAnalytics, UserFitnessAnalytics,
};
use enum_models::{ExerciseEquipment, ExerciseMuscle};
use hashbag::HashBag;
use itertools::Itertools;
use sea_orm::{
    ColumnTrait, DerivePartialModel, EntityTrait, FromQueryResult, QueryFilter, QueryTrait,
};
use supporting_service::SupportingService;

use crate::daily_activity_operations::get_daily_user_activities;

pub async fn user_analytics(
    supporting_service: &Arc<SupportingService>,
    user_id: &String,
    input: UserAnalyticsInput,
) -> Result<CachedResponse<UserAnalytics>> {
    supporting_service
        .cache_service
        .get_or_set_with_callback(
            ApplicationCacheKey::UserAnalytics(UserLevelCacheKey {
                input: input.clone(),
                user_id: user_id.to_owned(),
            }),
            ApplicationCacheValue::UserAnalytics,
            || async {
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
                    .all(&supporting_service.db)
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
                let activities =
                    get_daily_user_activities(supporting_service, user_id, input).await?;
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
                Ok(response)
            },
        )
        .await
}
