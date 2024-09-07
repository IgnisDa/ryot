use std::{fs, sync::Arc};

use async_graphql::Result;
use dependent_models::{CompleteExport, ImportResult};
use enums::ImportSource;
use fitness_service::ExerciseService;
use itertools::Itertools;
use media_models::DeployJsonImportInput;

pub async fn import(
    input: DeployJsonImportInput,
    exercises_service: &Arc<ExerciseService>,
) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let complete_data = serde_json::from_str::<CompleteExport>(&export).unwrap();

    let media = complete_data
        .media
        .unwrap_or_default()
        .iter_mut()
        .map(|m| {
            m.seen_history.iter_mut().for_each(|s| {
                s.provider_watched_on = Some(ImportSource::GenericJson.to_string());
            });
            m.to_owned()
        })
        .collect_vec();

    let workouts = complete_data
        .workouts
        .unwrap_or_default()
        .into_iter()
        .map(|w| exercises_service.db_workout_to_workout_input(w.details))
        .collect_vec();

    Ok(ImportResult {
        media,
        workouts,
        media_groups: complete_data.media_group.unwrap_or_default(),
        people: complete_data.people.unwrap_or_default(),
        measurements: complete_data.measurements.unwrap_or_default(),
        ..Default::default()
    })
}
