use async_graphql::{InputObject, SimpleObject};
use enum_models::UserLot;
use sea_orm::{FromJsonQueryResult, prelude::DateTimeUtc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
#[serde(tag = "t", content = "d")]
pub enum NotificationPlatformSpecifics {
    PushSafer {
        key: String,
    },
    Discord {
        url: String,
    },
    Email {
        email: String,
    },
    PushBullet {
        api_token: String,
    },
    Apprise {
        url: String,
        key: String,
    },
    Telegram {
        chat_id: String,
        bot_token: String,
    },
    PushOver {
        key: String,
        device: Option<String>,
        app_key: Option<String>,
    },
    Gotify {
        url: String,
        token: String,
        priority: Option<i32>,
    },
    Ntfy {
        topic: String,
        url: Option<String>,
        priority: Option<i32>,
        auth_header: Option<String>,
    },
}

#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    Serialize,
    PartialEq,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
pub struct UserExtraInformation {
    pub is_onboarding_tour_completed: bool,
    pub scheduled_for_workout_revision: bool,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
pub struct UserTwoFactorInformationBackupCode {
    pub code: String,
    pub used_at: Option<DateTimeUtc>,
}

#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize, FromJsonQueryResult)]
pub struct UserTwoFactorInformation {
    pub secret: String,
    pub backup_codes: Vec<UserTwoFactorInformationBackupCode>,
}

#[derive(Debug, InputObject)]
pub struct UpdateUserInput {
    pub user_id: String,
    pub lot: Option<UserLot>,
    pub username: Option<String>,
    pub is_disabled: Option<bool>,
    #[graphql(secret)]
    pub admin_access_token: Option<String>,
    pub is_onboarding_tour_completed: Option<bool>,
}
