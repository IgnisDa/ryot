use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use database_models::seen;
use media_models::{DeployImportJobInput, ProgressUpdateInput, ReviewPostedEvent};
use serde::{Deserialize, Serialize};
use strum::Display;
use uuid::Uuid;

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum HpApplicationJob {
    ReviewPosted(ReviewPostedEvent),
    SyncUserIntegrationsData(String),
    CalculateUserMetadataRecommendations(String),
    RecalculateUserActivitiesAndSummary(String, bool),
    BulkProgressUpdate(String, Vec<ProgressUpdateInput>),
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
    RecalculateCalendarEvents,
    ReviseUserWorkouts(String),
    UpdateMetadataGroup(String),
    ImportFromExternalSource(String, Box<DeployImportJobInput>),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum LpApplicationJob {
    HandleOnSeenComplete(String),
    HandleEntityAddedToCollectionEvent(Uuid),
    HandleAfterMediaSeenTasks(Box<seen::Model>),
    UpdateUserLastActivityPerformed(String, DateTime<Utc>),
}

#[derive(Debug, Deserialize, Serialize, Display, Clone)]
pub enum ApplicationJob {
    Lp(LpApplicationJob),
    Hp(HpApplicationJob),
    Mp(MpApplicationJob),
}

pub struct ScheduledJob(pub DateTime<Tz>);

impl From<DateTime<Tz>> for ScheduledJob {
    fn from(value: DateTime<Tz>) -> Self {
        Self(value)
    }
}
