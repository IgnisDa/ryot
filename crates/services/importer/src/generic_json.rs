use std::fs;

use async_graphql::Result;
use dependent_models::{CompleteExport, ImportCompletedItem, ImportResult};
use enum_models::ImportSource;
use itertools::Itertools;
use media_models::DeployJsonImportInput;

pub async fn import(input: DeployJsonImportInput) -> Result<ImportResult> {
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

    let mut completed = vec![];
    for media in media {
        completed.push(ImportCompletedItem::Metadata(media));
    }
    for people in complete_data.people.unwrap_or_default() {
        completed.push(ImportCompletedItem::Person(people));
    }
    for measurement in complete_data.measurements.unwrap_or_default() {
        completed.push(ImportCompletedItem::Measurement(measurement));
    }
    for workout in complete_data.workouts.unwrap_or_default() {
        completed.push(ImportCompletedItem::ApplicationWorkout(workout));
    }
    for media_group in complete_data.media_groups.unwrap_or_default() {
        completed.push(ImportCompletedItem::MetadataGroup(media_group));
    }
    Ok(ImportResult {
        completed,
        ..Default::default()
    })
}
