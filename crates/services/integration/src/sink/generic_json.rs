use anyhow::{bail, Result};
use dependent_models::{CompleteExport, ImportResult};

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
        Ok(ImportResult {
            metadata: payload.media.unwrap_or_default(),
            people: payload.people.unwrap_or_default(),
            measurements: payload.measurements.unwrap_or_default(),
            metadata_groups: payload.media_groups.unwrap_or_default(),
            application_workouts: payload.workouts.unwrap_or_default(),
            ..Default::default()
        })
    }
}
