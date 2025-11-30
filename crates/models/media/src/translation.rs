use async_graphql::SimpleObject;
use enum_models::EntityTranslationVariant;
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EntityTranslationDetails {
    pub title: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct GraphqlEntityTranslationDetail {
    pub value: Option<String>,
    pub variant: EntityTranslationVariant,
}
