use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EntityLanguageTranslationDetails {
    pub language: String,
    pub value: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EntityTranslationDetails {
    pub titles: Vec<EntityLanguageTranslationDetails>,
    pub descriptions: Vec<EntityLanguageTranslationDetails>,
}
