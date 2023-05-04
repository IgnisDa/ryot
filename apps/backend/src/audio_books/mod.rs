use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

pub mod audible;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct AudioBookSpecifics {
    pub runtime: Option<i32>,
}
