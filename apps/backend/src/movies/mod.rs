use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

pub mod resolver;
pub mod tmdb;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MovieSpecifics {
    pub runtime: Option<i32>,
}
