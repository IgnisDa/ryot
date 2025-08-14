use common_models::ChangeCollectionToEntitiesInput;
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
    BulkMetadataProgressUpdate(String, Vec<MetadataProgressUpdateInput>),
    AddEntitiesToCollection(String, ChangeCollectionToEntitiesInput),
    RemoveEntitiesFromCollection(String, ChangeCollectionToEntitiesInput),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum MpApplicationJob {
    UpdatePerson(String),
    SyncIntegrationsData,
    UpdateExerciseLibrary,
    PerformExport(String),
    UpdateGithubExercises,
    UpdateMetadata(String),
    PerformBackgroundTasks,
    ReviseUserWorkouts(String),
    UpdateMetadataGroup(String),
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
pub enum ApplicationJob {
    Lp(LpApplicationJob),
    Hp(HpApplicationJob),
    Mp(MpApplicationJob),
}

#[derive(Debug, Default)]
pub struct ScheduledJob;
