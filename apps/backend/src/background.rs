use apalis::prelude::{Job, JobContext, JobError};
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

use crate::{
    config::AppConfig,
    entities::{metadata, seen},
    graphql::Identifier,
    importer::{DeployImportInput, ImporterService},
    media::resolver::MediaService,
    misc::{resolver::MiscService, DefaultCollection},
    users::resolver::UsersService,
};

// Cron Jobs

#[derive(Debug, Deserialize, Serialize)]
pub struct ScheduledJob(DateTimeUtc);

impl From<DateTimeUtc> for ScheduledJob {
    fn from(value: DateTimeUtc) -> Self {
        Self(value)
    }
}

impl Job for ScheduledJob {
    const NAME: &'static str = "apalis::ScheduledJob";
}

pub async fn general_media_cleanup_jobs(
    _information: ScheduledJob,
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

pub async fn general_user_cleanup(
    _information: ScheduledJob,
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

// Application Jobs

#[derive(Debug, Deserialize, Serialize)]
pub struct ImportMedia {
    pub user_id: Identifier,
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
        .import_from_source(
            information.user_id.into(),
            information.input,
            &config.importer,
        )
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UserCreatedJob {
    pub user_id: Identifier,
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
        .user_created_job(&information.user_id.into())
        .await
        .unwrap();
    service
        .regenerate_user_summary(&information.user_id.into())
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AfterMediaSeenJob {
    pub seen: seen::Model,
}

impl Job for AfterMediaSeenJob {
    const NAME: &'static str = "apalis::AfterMediaSeenJob";
}

pub async fn after_media_seen_job(
    information: AfterMediaSeenJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::info!(
        "Running jobs after media item seen {:?}",
        information.seen.id
    );
    let misc_service = ctx.data::<MiscService>().unwrap();
    misc_service
        .remove_media_item_from_collection(
            &information.seen.user_id,
            &information.seen.metadata_id,
            &DefaultCollection::Watchlist.to_string(),
        )
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RecalculateUserSummaryJob {
    pub user_id: Identifier,
}

impl Job for RecalculateUserSummaryJob {
    const NAME: &'static str = "apalis::RecalculateUserSummaryJob";
}

pub async fn recalculate_user_summary_job(
    information: RecalculateUserSummaryJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::info!("Calculating summary for user {:?}", information.user_id);
    ctx.data::<UsersService>()
        .unwrap()
        .regenerate_user_summary(&information.user_id.into())
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateMetadataJob {
    pub metadata: metadata::Model,
}

impl Job for UpdateMetadataJob {
    const NAME: &'static str = "apalis::UpdateMetadataJob";
}

pub async fn update_metadata_job(
    information: UpdateMetadataJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::info!("Updating metadata for {:?}", information.metadata.id);
    Ok(())
}
