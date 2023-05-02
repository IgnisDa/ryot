use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

pub mod igdb;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct VideoGameSpecifics {
    pub rating: Option<f32>,
}
