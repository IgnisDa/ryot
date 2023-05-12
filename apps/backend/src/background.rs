use apalis::prelude::{Job, JobContext, JobError};
use serde::{Deserialize, Serialize};

use crate::{
    config::AppConfig,
    importer::{DeployImportInput, ImporterService},
    media::resolver::MediaService,
};

#[derive(Debug, Deserialize, Serialize)]
pub struct ImportMedia {
    pub user_id: i32,
    pub input: DeployImportInput,
}

impl Job for ImportMedia {
    const NAME: &'static str = "apalis::ImportMedia";
}

pub async fn import_media(information: ImportMedia, ctx: JobContext) -> Result<(), JobError> {
    let config = ctx.data::<AppConfig>().unwrap();
    ctx.data::<ImporterService>()
        .unwrap()
        .import_from_source(information.user_id, information.input, &config.importer)
        .await
        .unwrap();
    Ok(())
}

// TODO: Job that invalidates import jobs that have been running too long

#[derive(Debug, Deserialize, Serialize)]
pub struct RefreshUserToMediaAssociation {}

impl Job for RefreshUserToMediaAssociation {
    const NAME: &'static str = "apalis::RefreshUserToMediaAssociation";
}

// runs every 5 minutes
pub async fn refresh_user_to_media_association(
    _information: RefreshUserToMediaAssociation,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::debug!("Running user and metadata association cleanup");
    ctx.data::<MediaService>()
        .unwrap()
        .cleanup_user_and_metadata_association()
        .await
        .unwrap();
    Ok(())
}
