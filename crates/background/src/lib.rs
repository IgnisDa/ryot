use chrono::DateTime;
use chrono_tz::Tz;
use database_models::seen;
use fitness_models::GithubExercise;
use media_models::{
    CommitMediaInput, DeployImportJobInput, ProgressUpdateInput, ReviewPostedEvent,
};
use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

// The background jobs which cannot be throttled.
#[derive(Debug, Deserialize, Serialize, Display)]
pub enum CoreApplicationJob {
    SyncIntegrationsData(String),
    ReviewPosted(ReviewPostedEvent),
    BulkProgressUpdate(String, Vec<ProgressUpdateInput>),
}

// The background jobs which can be deployed by the application.
#[derive(Debug, Deserialize, Serialize, Display)]
pub enum ApplicationJob {
    UpdatePerson(String),
    SyncIntegrationsData,
    UpdateExerciseLibrary,
    PerformExport(String),
    UpdateMetadata(String),
    PerformBackgroundTasks,
    RecalculateCalendarEvents,
    ReviseUserWorkouts(String),
    UpdateMetadataGroup(String),
    HandleOnSeenComplete(String),
    HandleAfterMediaSeenTasks(seen::Model),
    UpdateGithubExerciseJob(GithubExercise),
    HandleEntityAddedToCollectionEvent(Uuid),
    AssociateGroupWithMetadata(CommitMediaInput),
    RecalculateUserActivitiesAndSummary(String, bool),
    ImportFromExternalSource(String, Box<DeployImportJobInput>),
}

// Cron Jobs
pub struct ScheduledJob(pub DateTime<Tz>);

impl From<DateTime<Tz>> for ScheduledJob {
    fn from(value: DateTime<Tz>) -> Self {
        Self(value)
    }
}
