use async_graphql::SimpleObject;
use sea_orm::{prelude::DateTimeUtc, FromJsonQueryResult};
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserNotificationsPreferences {
    pub released: bool,
    pub episode_released: bool,
    // TODO: Start storing status in the database.
    // pub status_changed: bool,
    pub release_date_changed: bool,
    pub number_of_seasons_changed: bool,
}

impl Default for UserNotificationsPreferences {
    fn default() -> Self {
        Self {
            released: true,
            episode_released: true,
            release_date_changed: true,
            number_of_seasons_changed: true,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, FromJsonQueryResult,
)]
pub struct UserFeaturesEnabledPreferences {
    pub anime: bool,
    pub audio_books: bool,
    pub books: bool,
    pub manga: bool,
    pub movies: bool,
    pub podcasts: bool,
    pub shows: bool,
    pub video_games: bool,
}

impl Default for UserFeaturesEnabledPreferences {
    fn default() -> Self {
        Self {
            anime: true,
            audio_books: true,
            books: true,
            manga: true,
            movies: true,
            podcasts: true,
            shows: true,
            video_games: true,
        }
    }
}

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, Eq, PartialEq, Default, FromJsonQueryResult,
)]
pub struct UserPreferences {
    #[serde(default)]
    pub features_enabled: UserFeaturesEnabledPreferences,
    #[serde(default)]
    pub notifications: UserNotificationsPreferences,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
#[serde(tag = "t", content = "d")]
pub enum UserYankIntegrationSetting {
    Audiobookshelf { base_url: String, token: String },
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserYankIntegration {
    pub id: usize,
    pub settings: UserYankIntegrationSetting,
    /// the date and time it was added on
    pub timestamp: DateTimeUtc,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserYankIntegrations(pub Vec<UserYankIntegration>);

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
#[serde(tag = "t", content = "d")]
pub enum UserSinkIntegrationSetting {
    Jellyfin { slug: String },
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserSinkIntegration {
    pub id: usize,
    pub settings: UserSinkIntegrationSetting,
    /// the date and time it was added on
    pub timestamp: DateTimeUtc,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, FromJsonQueryResult)]
pub struct UserSinkIntegrations(pub Vec<UserSinkIntegration>);
