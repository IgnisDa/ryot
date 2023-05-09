use apalis::prelude::{Job, JobContext, JobError};
use serde::{Deserialize, Serialize};

use crate::importer::MediaTrackerImportInput;

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
    input: MediaTrackerImportInput,
}

impl Job for ImportMedia {
    const NAME: &'static str = "apalis::ImportMedia";
}

pub async fn import_media(information: ImportMedia, _ctx: JobContext) -> Result<(), JobError> {
    tracing::trace!("Importing stuff");
    Ok(())
}
