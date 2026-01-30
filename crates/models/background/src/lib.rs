use common_models::{ChangeCollectionToEntitiesInput, EntityWithLot};
use enum_models::{EntityLot, EntityTranslationVariant};
use media_models::{
    DeployImportJobInput, MetadataProgressUpdateInput, PodcastTranslationExtraInformation,
    ReviewPostedEvent, ShowTranslationExtraInformation,
};
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

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UpdateMediaTranslationJobInput {
    pub user_id: String,
    pub entity_id: String,
    pub entity_lot: EntityLot,
    pub variant: EntityTranslationVariant,
    pub show_extra_information: Option<ShowTranslationExtraInformation>,
    pub podcast_extra_information: Option<PodcastTranslationExtraInformation>,
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
    UpdateMediaTranslations(UpdateMediaTranslationJobInput),
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
