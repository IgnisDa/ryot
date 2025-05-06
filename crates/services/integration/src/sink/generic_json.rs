use anyhow::{Result, bail};
use dependent_models::{CompleteExport, ImportCompletedItem, ImportResult};

pub async fn sink_progress(payload: String) -> Result<Option<ImportResult>> {
    let payload = match serde_json::from_str::<CompleteExport>(&payload) {
        Ok(val) => val,
        Err(err) => bail!(err),
    };
    let mut completed = vec![];
    for media in payload.metadata.unwrap_or_default() {
        completed.push(ImportCompletedItem::Metadata(media));
    }
    for people in payload.people.unwrap_or_default() {
        completed.push(ImportCompletedItem::Person(people));
    }
    for measurement in payload.measurements.unwrap_or_default() {
        completed.push(ImportCompletedItem::Measurement(measurement));
    }
    for workout in payload.workouts.unwrap_or_default() {
        completed.push(ImportCompletedItem::ApplicationWorkout(Box::new(workout)));
    }
    for media_group in payload.metadata_groups.unwrap_or_default() {
        completed.push(ImportCompletedItem::MetadataGroup(media_group));
    }
    Ok(Some(ImportResult {
        completed,
        ..Default::default()
    }))
}
