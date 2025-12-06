use common_models::{ChangeCollectionToEntitiesInput, EntityWithLot};
use media_models::{DeployImportJobInput, MetadataProgressUpdateInput, ReviewPostedEvent};
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum HpApplicationJob {
    ReviewPosted(ReviewPostedEvent),
    SyncUserIntegrationsData(String),
    RecalculateUserActivitiesAndSummary(String, bool),
    AddEntitiesToCollection(String, ChangeCollectionToEntitiesInput),
    BulkMetadataProgressUpdate(String, Vec<MetadataProgressUpdateInput>),
    RemoveEntitiesFromCollection(String, ChangeCollectionToEntitiesInput),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum MpApplicationJob {
    SyncIntegrationsData,
    UpdateExerciseLibrary,
    PerformExport(String),
    UpdateGithubExercises,
    PerformBackgroundTasks,
    UpdatePerson(String),
    UpdateMetadata(String),
    ReviseUserWorkouts(String),
    UpdateMetadataGroup(String),
    UpdateEntityTranslations(String, EntityWithLot),
    ImportFromExternalSource(String, Box<DeployImportJobInput>),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum LpApplicationJob {
    HandleOnSeenComplete(String),
    HandleEntityAddedToCollectionEvent(Uuid),
    UpdateUserLastActivityPerformed(String, DateTimeUtc),
    HandleMetadataEligibleForSmartCollectionMoving(String),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum SingleApplicationJob {
    ProcessIntegrationWebhook(String, String),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum ApplicationJob {
    Lp(LpApplicationJob),
    Hp(HpApplicationJob),
    Mp(MpApplicationJob),
    Single(SingleApplicationJob),
}

#[derive(Debug, Default)]
pub struct ScheduledJob;
