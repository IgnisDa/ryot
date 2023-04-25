use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

pub mod openlibrary;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct BookSpecifics {
    pub pages: Option<i32>,
}
