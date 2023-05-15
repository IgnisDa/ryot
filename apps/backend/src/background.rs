use apalis::prelude::{Job, JobContext, JobError};
use sea_orm::{DatabaseConnection, EntityTrait};
use serde::{Deserialize, Serialize};

use crate::{
    config::AppConfig,
    entities::prelude::Seen,
    importer::{DeployImportInput, ImporterService},
    media::resolver::MediaService,
    misc::{resolver::MiscService, WATCHLIST},
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
    tracing::info!("Importing media");
    let config = ctx.data::<AppConfig>().unwrap();
    ctx.data::<ImporterService>()
        .unwrap()
        .import_from_source(information.user_id, information.input, &config.importer)
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GeneralMediaCleanJobs;

impl Job for GeneralMediaCleanJobs {
    const NAME: &'static str = "apalis::GeneralMediaCleanupJob";
}

pub async fn general_media_cleanup_jobs(
    _information: GeneralMediaCleanJobs,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::info!("Invalidating invalid media import jobs");
    ctx.data::<ImporterService>()
        .unwrap()
        .invalidate_import_jobs()
        .await
        .unwrap();
    tracing::info!("Cleaning up media items without associated user activities");
    ctx.data::<MediaService>()
        .unwrap()
        .cleanup_metadata_with_associated_user_activities()
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GeneralUserCleanup;

impl Job for GeneralUserCleanup {
    const NAME: &'static str = "apalis::GeneralUserCleanup";
}

pub async fn general_user_cleanup(
    _information: GeneralUserCleanup,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::info!("Cleaning up user and metadata association");
    ctx.data::<MediaService>()
        .unwrap()
        .cleanup_user_and_metadata_association()
        .await
        .unwrap();
    tracing::info!("Removing old user summaries");
    ctx.data::<UsersService>()
        .unwrap()
        .cleanup_user_summaries()
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
    tracing::info!("Running jobs after user creation");
    let service = ctx.data::<UsersService>().unwrap();
    service
        .user_created_job(&information.user_id)
        .await
        .unwrap();
    service
        .regenerate_user_summary(&information.user_id)
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AfterMediaSeenJob {
    pub seen_id: i32,
}

impl Job for AfterMediaSeenJob {
    const NAME: &'static str = "apalis::AfterMediaSeenJob";
}

pub async fn after_media_seen_job(
    information: AfterMediaSeenJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::info!("Running jobs after media item seen");
    let db = ctx.data::<DatabaseConnection>().unwrap();
    let seen = Seen::find_by_id(information.seen_id)
        .one(db)
        .await
        .unwrap()
        .unwrap();
    let misc_service = ctx.data::<MiscService>().unwrap();
    misc_service
        .remove_media_item_from_collection(&seen.user_id, &seen.metadata_id, WATCHLIST)
        .await
        .unwrap();
    ctx.data::<UsersService>()
        .unwrap()
        .regenerate_user_summary(&seen.user_id)
        .await
        .unwrap();
    Ok(())
}
