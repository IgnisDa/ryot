use common_models::{ChangeCollectionToEntitiesInput, EntityWithLot};
use media_models::{DeployImportJobInput, MetadataProgressUpdateInput, ReviewPostedEvent};
use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum HpApplicationJob {
    ReviewPosted(ReviewPostedEvent),
    SyncUserIntegrationsData(String),
    RecalculateUserActivitiesAndSummary(String, bool),
    AddEntitiesToCollection(String, ChangeCollectionToEntitiesInput),
    RemoveEntitiesFromCollection(String, ChangeCollectionToEntitiesInput),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum MpApplicationJob {
    SyncIntegrationsData,
    PerformExport(String),
    UpdateExerciseLibrary,
    UpdateGithubExercises,
    PerformBackgroundTasks,
    ReviseUserWorkouts(String),
    UpdateMediaDetails(EntityWithLot),
    UpdateMediaTranslations(String, EntityWithLot),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum LpApplicationJob {
    HandleOnSeenComplete(String),
    HandleEntityAddedToCollectionEvent(Uuid),
    HandleMetadataEligibleForSmartCollectionMoving(String),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum SingleApplicationJob {
    ProcessIntegrationWebhook(String, String),
    ImportFromExternalSource(String, Box<DeployImportJobInput>),
    BulkMetadataProgressUpdate(String, Vec<MetadataProgressUpdateInput>),
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
