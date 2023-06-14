use async_graphql::{InputObject, SimpleObject};
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

pub mod igdb;

#[derive(
    Debug,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    Clone,
    Default,
    FromJsonQueryResult,
    InputObject,
)]
#[graphql(input_name = "VideoGameSpecificsInput")]
pub struct VideoGameSpecifics {
    pub platforms: Vec<String>,
}
