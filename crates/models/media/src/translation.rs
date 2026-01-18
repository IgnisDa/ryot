use async_graphql::SimpleObject;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, SimpleObject, FromJsonQueryResult,
)]
pub struct ShowTranslationExtraInformation {
    pub season_number: i32,
    pub episode_number: Option<i32>,
}

#[derive(
    Debug, Clone, PartialEq, Eq, Serialize, Deserialize, SimpleObject, FromJsonQueryResult,
)]
pub struct PodcastTranslationExtraInformation {
    pub episode_number: i32,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EntityTranslationDetails {
    pub image: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub seasons: Option<Vec<SeasonTranslationDetails>>,
    pub episodes: Option<Vec<EpisodeTranslationDetails>>,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct SeasonTranslationDetails {
    pub season_number: i32,
    pub name: Option<String>,
    pub overview: Option<String>,
    pub episodes: Vec<EpisodeTranslationDetails>,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EpisodeTranslationDetails {
    pub episode_number: i32,
    pub name: Option<String>,
    pub overview: Option<String>,
}
