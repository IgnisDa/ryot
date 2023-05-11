use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

use crate::{migrator::VideoGameSource, traits::MediaSpecifics};

pub mod igdb;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct VideoGameSpecifics {
    pub source: VideoGameSource,
}

impl MediaSpecifics for VideoGameSpecifics {}
