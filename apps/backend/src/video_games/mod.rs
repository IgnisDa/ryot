use async_graphql::{InputObject, SimpleObject};
use serde::{Deserialize, Serialize};

use crate::migrator::VideoGameSource;

pub mod igdb;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject)]
#[graphql(input_name = "VideoGameSpecificsInput")]
pub struct VideoGameSpecifics {
    pub source: VideoGameSource,
}
