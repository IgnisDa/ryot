use async_graphql::{InputObject, SimpleObject};
use serde::{Deserialize, Serialize};

pub mod audible;
pub mod resolver;

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, PartialEq, Eq, Default,
)]
#[graphql(input_name = "AudioBookSpecificsInput")]
pub struct AudioBookSpecifics {
    pub runtime: Option<i32>,
}
