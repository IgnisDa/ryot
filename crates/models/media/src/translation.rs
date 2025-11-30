use async_graphql::{InputObject, SimpleObject};
use enum_models::EntityLot;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, SimpleObject, Clone)]
pub struct EntityTranslationDetails {
    pub title: Option<String>,
    pub description: Option<String>,
}

#[skip_serializing_none]
#[derive(Clone, InputObject, Hash, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityTranslationInput {
    pub entity_id: String,
    pub entity_lot: EntityLot,
}
