use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

use crate::migrator::BookSource;

pub mod openlibrary;
pub mod resolver;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct BookSpecifics {
    pub pages: Option<i32>,
    pub source: BookSource,
}
