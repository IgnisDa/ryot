use std::fs;

use anyhow::Result;
use dependent_models::{CompleteExport, ImportCompletedItem, ImportResult};
use enum_models::ImportSource;
use itertools::Itertools;
use media_models::{CreateOrUpdateCollectionInput, DeployPathImportInput};

pub async fn import(input: DeployPathImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export_path)?;
    let complete_data = serde_json::from_str::<CompleteExport>(&export).unwrap();

    let media = complete_data
        .metadata
        .unwrap_or_default()
        .iter_mut()
        .map(|m| {
            m.seen_history.iter_mut().for_each(|s| {
                if s.providers_consumed_on.is_none() {
                    s.providers_consumed_on = Some(vec![ImportSource::GenericJson.to_string()]);
                }
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
        completed.push(ImportCompletedItem::ApplicationWorkout(Box::new(workout)));
    }
    for media_group in complete_data.metadata_groups.unwrap_or_default() {
        completed.push(ImportCompletedItem::MetadataGroup(media_group));
    }
    for collection in complete_data.collections.unwrap_or_default() {
        let collection_input = CreateOrUpdateCollectionInput {
            name: collection.name,
            description: collection.description,
            information_template: collection.information_template,
            ..Default::default()
        };
        completed.push(ImportCompletedItem::Collection(collection_input));
    }
    Ok(ImportResult {
        completed,
        ..Default::default()
    })
}
