use async_graphql::{InputObject, SimpleObject};
use serde::{Deserialize, Serialize};



pub mod openlibrary;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, InputObject)]
#[graphql(input_name = "BookSpecificsInput")]
pub struct BookSpecifics {
    pub pages: Option<i32>,
}
