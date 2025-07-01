use async_graphql::{Enum, InputObject, SimpleObject};
use common_models::{
    CollectionExtraInformation, IdAndNamedObject, UserToCollectionExtraInformation,
};
use enum_models::{EntityLot, MediaLot};
use schematic::Schematic;
use sea_orm::{FromJsonQueryResult, FromQueryResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, InputObject, Default, Clone, Serialize)]
pub struct CreateOrUpdateCollectionInput {
    pub name: String,
    pub update_id: Option<String>,
    pub description: Option<String>,
    pub collaborators: Option<Vec<String>>,
    pub extra_information: Option<UserToCollectionExtraInformation>,
    pub information_template: Option<Vec<CollectionExtraInformation>>,
}

#[derive(Debug, Serialize, Hash, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum CollectionContentsSortBy {
    Date,
    Title,
    Random,
    #[default]
    LastUpdatedOn,
}

#[derive(Debug, Hash, PartialEq, Eq, Clone, Serialize, Deserialize, InputObject, Default)]
pub struct CollectionContentsFilter {
    pub entity_lot: Option<EntityLot>,
    pub metadata_lot: Option<MediaLot>,
}

#[derive(
    Eq,
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Schematic,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
pub struct CollectionItemCollaboratorInformation {
    pub collaborator: IdAndNamedObject,
    pub extra_information: Option<UserToCollectionExtraInformation>,
}

#[derive(
    Debug, Clone, SimpleObject, FromQueryResult, PartialEq, Eq, Serialize, Deserialize, Schematic,
)]
pub struct CollectionItem {
    pub id: String,
    pub count: i64,
    pub name: String,
    pub is_default: bool,
    pub creator: IdAndNamedObject,
    pub description: Option<String>,
    pub collaborators: Vec<CollectionItemCollaboratorInformation>,
    pub information_template: Option<Vec<CollectionExtraInformation>>,
}
