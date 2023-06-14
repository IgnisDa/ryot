use async_graphql::{InputObject, SimpleObject};
use serde::{Deserialize, Serialize};

pub mod openlibrary;

#[derive(
    Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject, PartialEq, Eq, Default,
)]
#[graphql(input_name = "BookSpecificsInput")]
pub struct BookSpecifics {
    pub pages: Option<i32>,
}
