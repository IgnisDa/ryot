use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

use crate::{migrator::AudioBookSource, traits::MediaSpecifics};

pub mod audible;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct AudioBookSpecifics {
    pub runtime: Option<i32>,
    pub source: AudioBookSource,
}

impl MediaSpecifics for AudioBookSpecifics {}
