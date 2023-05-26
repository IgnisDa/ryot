use async_graphql::SimpleObject;

use chrono::NaiveDate;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

use crate::migrator::ShowSource;

pub mod resolver;
pub mod tmdb;

#[derive(
    Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone, Default, FromJsonQueryResult,
)]
pub struct ShowSpecifics {
    pub seasons: Vec<ShowSeason>,
    pub source: ShowSource,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    Hash,
)]
pub struct ShowSeason {
    pub id: i32,
    pub season_number: i32,
    pub name: String,
    pub publish_date: Option<NaiveDate>,
    pub episodes: Vec<ShowEpisode>,
    pub overview: Option<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
}

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    Hash,
)]
pub struct ShowEpisode {
    pub id: i32,
    pub episode_number: i32,
    pub publish_date: Option<NaiveDate>,
    pub name: String,
    pub overview: Option<String>,
    pub poster_images: Vec<String>,
    pub runtime: Option<i32>,
}
