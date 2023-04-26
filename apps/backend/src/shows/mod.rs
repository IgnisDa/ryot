use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

pub mod resolver;
pub mod tmdb;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ShowSpecifics {
    pub runtime: Option<i32>,
    pub seasons: Vec<ShowSeason>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ShowSeason {
    pub season_number: i32,
    pub name: String,
    pub episodes: Vec<ShowEpisode>,
    pub overview: Option<String>,
    pub poster_path: Option<String>,
    pub backdrop_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ShowEpisode {
    pub episode_number: i32,
    pub name: String,
    pub overview: Option<String>,
}
