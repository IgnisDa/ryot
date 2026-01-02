use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, entity::prelude::StringLen};
use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter};

#[derive(
    Eq,
    Copy,
    Hash,
    Enum,
    Debug,
    Clone,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[strum(serialize_all = "snake_case")]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum FilterPresetContextType {
    PeopleList,
    PeopleSearch,
    MetadataList,
    ExercisesList,
    MetadataSearch,
    CollectionContents,
    MetadataGroupsList,
    FitnessEntitiesList,
    MetadataGroupsSearch,
}

#[derive(
    Eq,
    Copy,
    Hash,
    Enum,
    Debug,
    Clone,
    Default,
    Display,
    EnumIter,
    PartialEq,
    Serialize,
    Deserialize,
    DeriveActiveEnum,
)]
#[strum(serialize_all = "snake_case")]
#[sea_orm(
    rs_type = "String",
    rename_all = "snake_case",
    db_type = "String(StringLen::None)"
)]
pub enum EntityTranslationVariant {
    #[default]
    Title,
    Image,
    Description,
}
