use async_graphql::{Enum, InputObject, SimpleObject};
use educe::Educe;
use enum_models::{MediaLot, UserLot};
use fitness_models::{SetRestTimersSettings, UserUnitSystem};
use sea_orm::{FromJsonQueryResult, Iterable, prelude::DateTimeUtc};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use strum::EnumString;

const MOVIE_WATCH_PROVIDERS: [&str; 8] = [
    "Netflix",
    "Amazon Prime",
    "Disney+",
    "HBO Max",
    "Apple TV",
    "Peacock",
    "Hulu",
    "Crunchyroll",
];

#[derive(
    Eq,
    Educe,
    Clone,
    Debug,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[educe(Default)]
#[graphql(input_name = "UserMediaFeaturesEnabledPreferencesInput")]
pub struct UserMediaFeaturesEnabledPreferences {
    #[educe(Default = true)]
    pub enabled: bool,
    #[educe(Default = true)]
    pub people: bool,
    #[educe(Default = true)]
    pub groups: bool,
    #[educe(Default = true)]
    pub genres: bool,
    #[educe(Default = MediaLot::iter().collect())]
    pub specific: Vec<MediaLot>,
}

#[derive(
    Eq,
    Educe,
    Clone,
    Debug,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[educe(Default)]
#[graphql(input_name = "UserOthersFeaturesEnabledPreferencesInput")]
pub struct UserOthersFeaturesEnabledPreferences {
    #[educe(Default = true)]
    pub collections: bool,
    #[educe(Default = true)]
    pub calendar: bool,
}

#[derive(
    Eq,
    Clone,
    Educe,
    Debug,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[educe(Default)]
#[graphql(input_name = "UserFitnessFeaturesEnabledPreferencesInput")]
pub struct UserFitnessFeaturesEnabledPreferences {
    #[educe(Default = true)]
    pub enabled: bool,
    #[educe(Default = true)]
    pub measurements: bool,
    #[educe(Default = true)]
    pub workouts: bool,
    #[educe(Default = true)]
    pub templates: bool,
}

#[derive(
    Eq,
    Clone,
    Debug,
    Educe,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserFitnessLoggingPreferencesInput")]
#[educe(Default)]
pub struct UserFitnessLoggingPreferences {
    pub mute_sounds: bool,
    #[educe(Default = "kcal")]
    pub calories_burnt_unit: String,
    pub prompt_for_rest_timer: bool,
    #[educe(Default = true)]
    pub start_timer_for_duration_exercises: bool,
}

#[derive(
    Eq,
    Educe,
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[educe(Default)]
#[graphql(input_name = "UserFitnessExercisesPreferencesInput")]
pub struct UserFitnessExercisesPreferences {
    #[educe(Default = UserUnitSystem::Metric)]
    pub unit_system: UserUnitSystem,
    pub set_rest_timers: SetRestTimersSettings,
}

#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserCustomMeasurementInput")]
#[serde(rename_all = "camelCase")]
pub struct UserStatisticsMeasurement {
    pub name: String,
    pub unit: Option<String>,
}

#[derive(
    Eq,
    Educe,
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserFitnessMeasurementsPreferencesInput")]
#[educe(Default)]
pub struct UserFitnessMeasurementsPreferences {
    #[educe(Default(expression = vec![
        UserStatisticsMeasurement {
            name: "weight".to_owned(),
            ..Default::default()
        },
        UserStatisticsMeasurement {
            name: "sugar_level".to_owned(),
            ..Default::default()
        },
    ]))]
    pub statistics: Vec<UserStatisticsMeasurement>,
}

#[derive(
    Eq,
    Educe,
    Clone,
    Debug,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserAnalyticsFeaturesEnabledPreferencesInput")]
#[educe(Default)]
pub struct UserAnalyticsFeaturesEnabledPreferences {
    #[educe(Default = true)]
    pub enabled: bool,
}

#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserFeaturesEnabledPreferencesInput")]
pub struct UserFeaturesEnabledPreferences {
    pub media: UserMediaFeaturesEnabledPreferences,
    pub others: UserOthersFeaturesEnabledPreferences,
    pub fitness: UserFitnessFeaturesEnabledPreferences,
    pub analytics: UserAnalyticsFeaturesEnabledPreferences,
}

#[derive(
    Eq,
    Clone,
    Debug,
    Educe,
    Serialize,
    PartialEq,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserFitnessPreferencesInput")]
#[educe(Default)]
pub struct UserFitnessPreferences {
    pub logging: UserFitnessLoggingPreferences,
    pub exercises: UserFitnessExercisesPreferences,
    pub measurements: UserFitnessMeasurementsPreferences,
}

#[derive(
    Debug,
    Serialize,
    Default,
    Deserialize,
    Enum,
    Clone,
    Eq,
    PartialEq,
    FromJsonQueryResult,
    Copy,
    EnumString,
)]
#[strum(ascii_case_insensitive, serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum UserReviewScale {
    OutOfTen,
    OutOfFive,
    #[default]
    OutOfHundred,
    ThreePointSmiley,
}

#[derive(
    Debug, Serialize, Deserialize, Enum, Clone, Eq, PartialEq, FromJsonQueryResult, Copy, Default,
)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DashboardElementLot {
    Summary,
    Upcoming,
    Trending,
    InProgress,
    #[default]
    Recommendations,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "camelCase")]
#[graphql(input_name = "UserGeneralDashboardElementInput")]
pub struct UserGeneralDashboardElement {
    pub hidden: bool,
    pub num_elements: Option<u64>,
    pub section: DashboardElementLot,
    pub deduplicate_media: Option<bool>,
}

#[skip_serializing_none]
#[derive(
    Eq,
    Clone,
    Debug,
    Serialize,
    PartialEq,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[serde(rename_all = "camelCase")]
#[graphql(input_name = "UserGeneralWatchProviderInput")]
pub struct UserGeneralWatchProvider {
    pub lot: MediaLot,
    pub values: Vec<String>,
}

#[derive(
    Eq,
    Educe,
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
    InputObject,
    SimpleObject,
    FromJsonQueryResult,
)]
#[educe(Default)]
#[graphql(input_name = "UserGeneralPreferencesInput")]
pub struct UserGeneralPreferences {
    #[educe(Default = true)]
    pub display_nsfw: bool,
    #[educe(Default = "/")]
    pub landing_path: String,
    #[educe(Default = 20)]
    pub list_page_size: u64,
    #[educe(Default = false)]
    pub disable_videos: bool,
    #[educe(Default = false)]
    pub disable_reviews: bool,
    #[educe(Default = UserReviewScale::OutOfHundred)]
    pub review_scale: UserReviewScale,
    #[educe(Default = false)]
    pub disable_watch_providers: bool,
    #[educe(Default = false)]
    pub disable_integrations: bool,
    #[educe(Default = false)]
    pub show_spoilers_in_calendar: bool,
    #[educe(Default = false)]
    pub disable_navigation_animation: bool,
    #[educe(Default(expression = vec![UserGeneralWatchProvider {
        lot: MediaLot::Movie,
        values: MOVIE_WATCH_PROVIDERS
            .into_iter()
            .map(|s| s.to_owned())
            .collect(),
    }]))]
    pub watch_providers: Vec<UserGeneralWatchProvider>,
    #[educe(Default(expression = vec![
        UserGeneralDashboardElement {
            num_elements: Some(8),
            deduplicate_media: Some(true),
            section: DashboardElementLot::Upcoming,
            ..Default::default()
        },
        UserGeneralDashboardElement {
            num_elements: Some(8),
            section: DashboardElementLot::InProgress,
            ..Default::default()
        },
        UserGeneralDashboardElement {
            section: DashboardElementLot::Summary,
            ..Default::default()
        },
        UserGeneralDashboardElement {
            num_elements: Some(8),
            section: DashboardElementLot::Recommendations,
            ..Default::default()
        },
        UserGeneralDashboardElement {
            num_elements: Some(8),
            section: DashboardElementLot::Trending,
            ..Default::default()
        },
    ]))]
    pub dashboard: Vec<UserGeneralDashboardElement>,
}

#[derive(
    Eq,
    Clone,
    Debug,
    Default,
    PartialEq,
    Serialize,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "UserPreferencesInput")]
pub struct UserPreferences {
    pub fitness: UserFitnessPreferences,
    pub general: UserGeneralPreferences,
    pub features_enabled: UserFeaturesEnabledPreferences,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
#[serde(tag = "t", content = "d")]
pub enum NotificationPlatformSpecifics {
    Apprise {
        url: String,
        key: String,
    },
    Discord {
        url: String,
    },
    Gotify {
        url: String,
        token: String,
        priority: Option<i32>,
    },
    Ntfy {
        url: Option<String>,
        topic: String,
        priority: Option<i32>,
        auth_header: Option<String>,
    },
    PushBullet {
        api_token: String,
    },
    PushOver {
        key: String,
        app_key: Option<String>,
    },
    PushSafer {
        key: String,
    },
    Telegram {
        bot_token: String,
        chat_id: String,
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
    pub admin_access_token: Option<String>,
    pub is_onboarding_tour_completed: Option<bool>,
}
