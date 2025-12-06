use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EntityTranslationDetails {
    pub title: Option<String>,
    pub description: Option<String>,
}
