use async_graphql::SimpleObject;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, Default, FromJsonQueryResult)]
pub struct AudiobookshelfIntegration {
    pub base_url: String,
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq, Default, FromJsonQueryResult)]
pub struct UserIntegrations {
    pub audiobookshelf: Vec<AudiobookshelfIntegration>,
}
