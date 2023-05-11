use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

use crate::{migrator::MovieSource, traits::MediaSpecifics};

pub mod resolver;
pub mod tmdb;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MovieSpecifics {
    pub runtime: Option<i32>,
    pub source: MovieSource,
}

impl MediaSpecifics for MovieSpecifics {}
