use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EntityLanguageTranslationDetails {
    pub value: String,
    pub language: String,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EntityTranslationDetails {
    pub titles: Vec<EntityLanguageTranslationDetails>,
    pub descriptions: Vec<EntityLanguageTranslationDetails>,
}
