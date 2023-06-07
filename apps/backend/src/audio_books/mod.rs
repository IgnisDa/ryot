use async_graphql::{InputObject, SimpleObject};
use serde::{Deserialize, Serialize};

use crate::migrator::AudioBookSource;

pub mod audible;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject)]
#[graphql(input_name = "AudioBookSpecificsInput")]
pub struct AudioBookSpecifics {
    pub runtime: Option<i32>,
}
