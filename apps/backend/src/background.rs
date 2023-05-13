use apalis::prelude::{Job, JobContext, JobError};
use serde::{Deserialize, Serialize};

use crate::{
    config::AppConfig,
    importer::{DeployImportInput, ImporterService},
    media::resolver::MediaService,
    users::resolver::UsersService,
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

#[derive(Debug, Deserialize, Serialize)]
pub struct InvalidateImportJob {}

impl Job for InvalidateImportJob {
    const NAME: &'static str = "apalis::InvalidateImportJob";
}

pub async fn invalidate_import_job(
    _information: InvalidateImportJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::debug!("Invalidating invalid media import jobs");
    ctx.data::<ImporterService>()
        .unwrap()
        .invalidate_import_jobs()
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RefreshUserToMediaAssociation {}

impl Job for RefreshUserToMediaAssociation {
    const NAME: &'static str = "apalis::RefreshUserToMediaAssociation";
}

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

#[derive(Debug, Deserialize, Serialize)]
pub struct UserCreatedJob {
    pub user_id: i32,
}

impl Job for UserCreatedJob {
    const NAME: &'static str = "apalis::UserCreatedJob";
}

pub async fn user_created_job(
    information: UserCreatedJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::debug!("Running jobs after user creation");
    ctx.data::<UsersService>()
        .unwrap()
        .user_created_job(&information.user_id)
        .await
        .unwrap();
    Ok(())
}
