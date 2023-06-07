use async_graphql::{InputObject, SimpleObject};
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};

use crate::migrator::VideoGameSource;

pub mod igdb;
pub mod resolver;

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
