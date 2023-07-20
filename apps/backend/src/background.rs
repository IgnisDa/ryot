use std::sync::Arc;

use apalis::prelude::{Job, JobContext, JobError};
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

use crate::{
    entities::{metadata, seen},
    fitness::exercise::resolver::ExerciseService,
    importer::{DeployImportJobInput, ImporterService},
    migrator::MetadataLot,
    miscellaneous::{resolver::MiscellaneousService, DefaultCollection},
    models::{fitness::Exercise, media::AddMediaToCollection},
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
    tracing::trace!("Invalidating invalid media import jobs");
    ctx.data::<Arc<ImporterService>>()
        .unwrap()
        .invalidate_import_jobs()
        .await
        .unwrap();
    tracing::trace!("Cleaning up media items without associated user activities");
    ctx.data::<Arc<MiscellaneousService>>()
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
    tracing::trace!("Cleaning up user and metadata association");
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .cleanup_user_and_metadata_association()
        .await
        .unwrap();
    tracing::trace!("Removing old user summaries and regenerating them");
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .regenerate_user_summaries()
        .await
        .unwrap();
    tracing::trace!("Removing old user authentication tokens");
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .delete_expired_user_auth_tokens()
        .await
        .unwrap();
    Ok(())
}

pub async fn yank_integrations_data(
    _information: ScheduledJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::trace!("Getting data from yanked integrations for all users");
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .yank_integrations_data()
        .await
        .unwrap();
    Ok(())
}

// Application Jobs

#[derive(Debug, Deserialize, Serialize)]
pub struct ImportMedia {
    pub user_id: i32,
    pub input: DeployImportJobInput,
}

impl Job for ImportMedia {
    const NAME: &'static str = "apalis::ImportMedia";
}

pub async fn import_media(information: ImportMedia, ctx: JobContext) -> Result<(), JobError> {
    tracing::trace!("Importing media");
    ctx.data::<Arc<ImporterService>>()
        .unwrap()
        .import_from_source(information.user_id, information.input)
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
    tracing::trace!("Running jobs after user creation");
    let service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    service
        .user_created_job(&information.user_id)
        .await
        .unwrap();
    service
        .calculate_user_summary(&information.user_id)
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct AfterMediaSeenJob {
    pub seen: seen::Model,
    pub metadata_lot: MetadataLot,
}

impl Job for AfterMediaSeenJob {
    const NAME: &'static str = "apalis::AfterMediaSeenJob";
}

// Everything except shows and podcasts are automatically removed from "In Progress"
// and "Watchlist". Podcasts and shows can not be removed from "In Progress" since
// it is not easy to determine which episode is the last one. That needs to be done
// manually.
// FIXME: Exclude season 0 from shows and then calculate if completed
pub async fn after_media_seen_job(
    information: AfterMediaSeenJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::trace!(
        "Running jobs after media item seen {:?}",
        information.seen.id
    );
    let media_service = ctx.data::<Arc<MiscellaneousService>>().unwrap();
    if information.seen.dropped {
        media_service
            .remove_media_item_from_collection(
                &information.seen.user_id,
                &information.seen.metadata_id,
                &DefaultCollection::Watchlist.to_string(),
            )
            .await
            .ok();
        media_service
            .remove_media_item_from_collection(
                &information.seen.user_id,
                &information.seen.metadata_id,
                &DefaultCollection::InProgress.to_string(),
            )
            .await
            .ok();
    } else if matches!(information.metadata_lot, MetadataLot::Show,)
        || matches!(information.metadata_lot, MetadataLot::Podcast)
    {
        media_service
            .add_media_to_collection(
                &information.seen.user_id,
                AddMediaToCollection {
                    collection_name: DefaultCollection::InProgress.to_string(),
                    media_id: information.seen.metadata_id,
                },
            )
            .await
            .ok();
    } else if information.seen.progress == 100 {
        media_service
            .remove_media_item_from_collection(
                &information.seen.user_id,
                &information.seen.metadata_id,
                &DefaultCollection::Watchlist.to_string(),
            )
            .await
            .ok();
        media_service
            .remove_media_item_from_collection(
                &information.seen.user_id,
                &information.seen.metadata_id,
                &DefaultCollection::InProgress.to_string(),
            )
            .await
            .ok();
    } else {
        media_service
            .add_media_to_collection(
                &information.seen.user_id,
                AddMediaToCollection {
                    collection_name: DefaultCollection::InProgress.to_string(),
                    media_id: information.seen.metadata_id,
                },
            )
            .await
            .ok();
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RecalculateUserSummaryJob {
    pub user_id: i32,
}

impl Job for RecalculateUserSummaryJob {
    const NAME: &'static str = "apalis::RecalculateUserSummaryJob";
}

pub async fn recalculate_user_summary_job(
    information: RecalculateUserSummaryJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::trace!("Calculating summary for user {:?}", information.user_id);
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .calculate_user_summary(&information.user_id)
        .await
        .unwrap();
    tracing::trace!(
        "Summary calculation complete for user {:?}",
        information.user_id
    );
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
    ctx.data::<Arc<MiscellaneousService>>()
        .unwrap()
        .update_metadata(information.metadata)
        .await
        .unwrap();
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
pub struct UpdateExerciseJob {
    pub exercise: Exercise,
}

impl Job for UpdateExerciseJob {
    const NAME: &'static str = "apalis::UpdateExerciseJob";
}

pub async fn update_exercise_job(
    information: UpdateExerciseJob,
    ctx: JobContext,
) -> Result<(), JobError> {
    tracing::trace!("Updating {:?}", information.exercise.name);
    ctx.data::<Arc<ExerciseService>>()
        .unwrap()
        .update_exercise(information.exercise)
        .await
        .unwrap();
    Ok(())
}
