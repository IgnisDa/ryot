use async_graphql::{InputObject, SimpleObject};
use serde::{Deserialize, Serialize};

pub mod tmdb;

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, Eq, PartialEq, Default,
)]
#[graphql(input_name = "MovieSpecificsInput")]
pub struct MovieSpecifics {
    pub runtime: Option<i32>,
}
