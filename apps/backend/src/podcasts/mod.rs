use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

use crate::migrator::VideoGameSource;

pub mod listennotes;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct PodcastSpecifics {
    pub source: VideoGameSource,
}
