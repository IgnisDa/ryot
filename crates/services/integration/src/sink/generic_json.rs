use anyhow::{bail, Result};
use dependent_models::{CompleteExport, ImportCompletedItem, ImportResult};

pub(crate) struct GenericJsonSinkIntegration {
    payload: String,
}
impl GenericJsonSinkIntegration {
    pub const fn new(payload: String) -> Self {
        Self { payload }
    }

    pub async fn yank_progress(&self) -> Result<ImportResult> {
        let payload = match serde_json::from_str::<CompleteExport>(&self.payload) {
            Ok(val) => val,
            Err(err) => bail!(err),
        };
        let mut completed = vec![];
        for media in payload.media.unwrap_or_default() {
            completed.push(ImportCompletedItem::Metadata(media));
        }
        for people in payload.people.unwrap_or_default() {
            completed.push(ImportCompletedItem::Person(people));
        }
        for measurement in payload.measurements.unwrap_or_default() {
            completed.push(ImportCompletedItem::Measurement(measurement));
        }
        for workout in payload.workouts.unwrap_or_default() {
            completed.push(ImportCompletedItem::ApplicationWorkout(workout));
        }
        for media_group in payload.media_groups.unwrap_or_default() {
            completed.push(ImportCompletedItem::MetadataGroup(media_group));
        }
        Ok(ImportResult {
            completed,
            ..Default::default()
        })
    }
}
