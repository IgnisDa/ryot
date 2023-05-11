use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

use crate::migrator::AudioBookSource;

pub mod audible;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct AudioBookSpecifics {
    pub runtime: Option<i32>,
    pub source: AudioBookSource,
}
