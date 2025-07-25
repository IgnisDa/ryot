use std::{fs::File as StdFile, sync::Arc};

use anyhow::{Result, anyhow};
use common_models::SearchInput;
use common_utils::ryot_log;
use database_models::prelude::Exercise;
use database_utils::{
    entity_in_collections_with_details, item_reviews, user_workout_details,
    user_workout_template_details,
};
use dependent_models::{ImportOrExportExerciseItem, UserTemplatesOrWorkoutsListInput};
use dependent_models::{ImportOrExportWorkoutItem, ImportOrExportWorkoutTemplateItem};
use dependent_utils::{
    user_exercises_list, user_measurements_list, user_workout_templates_list, user_workouts_list,
};
use enum_models::EntityLot;
use fitness_models::{UserExercisesListInput, UserMeasurementsListInput};
use itertools::Itertools;
use sea_orm::EntityTrait;
use struson::writer::{JsonStreamWriter, JsonWriter};
use supporting_service::SupportingService;

use crate::export_utilities::get_review_export_item;

pub async fn export_workouts(
    service: &Arc<SupportingService>,
    user_id: &String,
    writer: &mut JsonStreamWriter<StdFile>,
) -> Result<()> {
    let mut current_page = 1;
    loop {
        let workout_ids = user_workouts_list(
            user_id,
            UserTemplatesOrWorkoutsListInput {
                search: SearchInput {
                    take: Some(1000),
                    page: Some(current_page),
                    ..Default::default()
                },
                ..Default::default()
            },
            service,
        )
        .await?;
        ryot_log!(debug, "Exporting workouts list page: {current_page}");
        for workout_id in workout_ids.response.items {
            let details = user_workout_details(user_id, workout_id, service).await?;
            let exp = ImportOrExportWorkoutItem {
                details: details.details,
                collections: details.collections.into_iter().map(|c| c.details).collect(),
            };
            writer.serialize_value(&exp)?;
        }
        if let Some(next_page) = workout_ids.response.details.next_page {
            current_page = next_page;
        } else {
            break;
        }
    }
    Ok(())
}

pub async fn export_measurements(
    service: &Arc<SupportingService>,
    user_id: &String,
    writer: &mut JsonStreamWriter<StdFile>,
) -> Result<()> {
    let measurements =
        user_measurements_list(user_id, service, UserMeasurementsListInput::default()).await?;
    for measurement in measurements.response {
        writer.serialize_value(&measurement).unwrap();
    }
    Ok(())
}

pub async fn export_exercises(
    service: &Arc<SupportingService>,
    user_id: &String,
    writer: &mut JsonStreamWriter<StdFile>,
) -> Result<()> {
    let mut current_page = 1;
    loop {
        let exercises = user_exercises_list(
            user_id,
            UserExercisesListInput {
                search: SearchInput {
                    take: Some(1000),
                    page: Some(current_page),
                    ..Default::default()
                },
                ..Default::default()
            },
            service,
        )
        .await?;
        for exercise_id in exercises.response.items {
            let reviews = item_reviews(user_id, &exercise_id, EntityLot::Exercise, false, service)
                .await?
                .into_iter()
                .map(get_review_export_item)
                .collect_vec();
            let collections = entity_in_collections_with_details(
                &service.db,
                user_id,
                &exercise_id,
                EntityLot::Exercise,
            )
            .await?
            .into_iter()
            .map(|c| c.details)
            .collect_vec();
            if reviews.is_empty() && collections.is_empty() {
                continue;
            }
            let exercise = Exercise::find_by_id(exercise_id.clone())
                .one(&service.db)
                .await?
                .ok_or_else(|| anyhow!("Exercise with the given ID does not exist"))?;
            let exp = ImportOrExportExerciseItem {
                reviews,
                collections,
                id: exercise_id,
                name: exercise.name,
            };
            writer.serialize_value(&exp).unwrap();
        }
        if let Some(next_page) = exercises.response.details.next_page {
            current_page = next_page;
        } else {
            break;
        }
    }
    Ok(())
}

pub async fn export_workout_templates(
    service: &Arc<SupportingService>,
    user_id: &String,
    writer: &mut JsonStreamWriter<StdFile>,
) -> Result<()> {
    let mut current_page = 1;
    loop {
        let workout_template_ids = user_workout_templates_list(
            user_id,
            service,
            UserTemplatesOrWorkoutsListInput {
                search: SearchInput {
                    take: Some(1000),
                    page: Some(current_page),
                    ..Default::default()
                },
                ..Default::default()
            },
        )
        .await?;
        ryot_log!(debug, "Exporting templates list page: {current_page}");
        for workout_template_id in workout_template_ids.response.items {
            let details =
                user_workout_template_details(&service.db, user_id, workout_template_id).await?;
            let exp = ImportOrExportWorkoutTemplateItem {
                details: details.details,
                collections: details.collections.into_iter().map(|c| c.details).collect(),
            };
            writer.serialize_value(&exp).unwrap();
        }
        if let Some(next_page) = workout_template_ids.response.details.next_page {
            current_page = next_page;
        } else {
            break;
        }
    }
    Ok(())
}
