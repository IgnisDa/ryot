use anyhow::{bail, Result};
use dependent_models::{CompleteExport, ImportResult};

pub(crate) struct GenericJsonIntegration {
    payload: String,
}
impl GenericJsonIntegration {
    pub const fn new(payload: String) -> Self {
        Self { payload }
    }

    async fn generic_json_progress(&self) -> Result<ImportResult> {
        let payload = match serde_json::from_str::<CompleteExport>(&self.payload) {
            Ok(val) => val,
            Err(err) => bail!(err),
        };
        dbg!(&payload);
        todo!()
    }

    pub async fn yank_progress(&self) -> Result<ImportResult> {
        self.generic_json_progress().await
    }
}
