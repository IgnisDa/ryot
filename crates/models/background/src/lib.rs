use chrono::DateTime;
use chrono_tz::Tz;
use database_models::seen;
use media_models::{DeployImportJobInput, ProgressUpdateInput, ReviewPostedEvent};
use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum HighPriorityApplicationJob {
    SyncIntegrationsData(String),
    ReviewPosted(ReviewPostedEvent),
    BulkProgressUpdate(String, Vec<ProgressUpdateInput>),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum MediumPriorityApplicationJob {
    UpdatePerson(String),
    SyncIntegrationsData,
    UpdateExerciseLibrary,
    PerformExport(String),
    UpdateGithubExercises,
    UpdateMetadata(String),
    PerformBackgroundTasks,
    RecalculateCalendarEvents,
    ReviseUserWorkouts(String),
    UpdateMetadataGroup(String),
    ImportFromExternalSource(String, Box<DeployImportJobInput>),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum LowPriorityApplicationJob {
    HandleOnSeenComplete(String),
    HandleAfterMediaSeenTasks(seen::Model),
    HandleEntityAddedToCollectionEvent(Uuid),
    RecalculateUserActivitiesAndSummary(String, bool),
}

// Cron Jobs
pub struct ScheduledJob(pub DateTime<Tz>);

impl From<DateTime<Tz>> for ScheduledJob {
    fn from(value: DateTime<Tz>) -> Self {
        Self(value)
    }
}
