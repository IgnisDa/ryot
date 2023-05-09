use apalis::prelude::{Job, JobContext, JobError};
use serde::{Deserialize, Serialize};

use crate::importer::{DeployMediaTrackerImportInput, ImporterService};

#[derive(Debug, Deserialize, Serialize)]
pub struct RefreshMedia {}

impl Job for RefreshMedia {
    const NAME: &'static str = "apalis::RefreshMedia";
}

pub async fn refresh_media(information: RefreshMedia, _ctx: JobContext) -> Result<(), JobError> {
    tracing::trace!("Refresh media");
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ImportMedia {
    pub user_id: i32,
    pub input: DeployMediaTrackerImportInput,
}

impl Job for ImportMedia {
    const NAME: &'static str = "apalis::ImportMedia";
}

pub async fn import_media(information: ImportMedia, ctx: JobContext) -> Result<(), JobError> {
    ctx.data::<ImporterService>()
        .unwrap()
        .media_tracker_import(information.user_id, information.input)
        .await
        .unwrap();
    tracing::info!("Media import successful");
    Ok(())
}
