use async_graphql::SimpleObject;
use common_models::{BackendError, IdAndNamedObject};
use database_models::metadata;
use enum_models::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    MediaLot, MediaSource, WorkoutSetPersonalBest,
};
use media_models::{GenreListItem, MetadataCreatorsGroupedByRole};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ProviderSupportedLanguageInformation {
    pub value: String,
    pub label: String,
}

#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ProviderLanguageInformation {
    pub source: MediaSource,
    pub supported: Vec<ProviderSupportedLanguageInformation>,
}

#[derive(PartialEq, Eq, Debug, SimpleObject, Serialize, Deserialize, Clone)]
pub struct MetadataLotSourceMappings {
    pub lot: MediaLot,
    pub sources: Vec<MediaSource>,
}

#[skip_serializing_none]
#[derive(PartialEq, Eq, Clone, Debug, SimpleObject, Serialize, Deserialize)]
pub struct MetadataGroupSourceLotMapping {
    pub lot: MediaLot,
    pub source: MediaSource,
}

#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExerciseParametersLotMapping {
    pub lot: ExerciseLot,
    pub bests: Vec<WorkoutSetPersonalBest>,
}

#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExerciseFilters {
    #[graphql(name = "type")]
    pub lot: Vec<ExerciseLot>,
    pub level: Vec<ExerciseLevel>,
    pub force: Vec<ExerciseForce>,
    pub muscle: Vec<ExerciseMuscle>,
    pub mechanic: Vec<ExerciseMechanic>,
    pub equipment: Vec<ExerciseEquipment>,
}

#[derive(PartialEq, Eq, Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct ExerciseParameters {
    /// All filters applicable to an exercises query.
    pub filters: ExerciseFilters,
    /// Exercise type mapped to the personal bests possible.
    pub lot_mapping: Vec<ExerciseParametersLotMapping>,
}

#[derive(PartialEq, Default, Eq, Clone, Debug, SimpleObject, Serialize, Deserialize)]
pub struct CoreDetailsProviderIgdbSpecifics {
    pub themes: Vec<IdAndNamedObject>,
    pub genres: Vec<IdAndNamedObject>,
    pub platforms: Vec<IdAndNamedObject>,
    pub game_types: Vec<IdAndNamedObject>,
    pub game_modes: Vec<IdAndNamedObject>,
    pub release_date_regions: Vec<IdAndNamedObject>,
}

#[derive(PartialEq, Default, Eq, Clone, Debug, SimpleObject, Serialize, Deserialize)]
pub struct CoreDetailsProviderSpecifics {
    pub igdb: CoreDetailsProviderIgdbSpecifics,
}

#[derive(PartialEq, Eq, Clone, Debug, SimpleObject, Serialize, Deserialize)]
pub struct CoreDetails {
    pub page_size: u64,
    pub version: String,
    pub docs_link: String,
    pub oidc_enabled: bool,
    pub smtp_enabled: bool,
    pub website_url: String,
    pub signup_allowed: bool,
    pub is_demo_instance: bool,
    pub disable_telemetry: bool,
    pub max_file_size_mb: usize,
    pub repository_link: String,
    pub token_valid_for_days: i32,
    pub local_auth_disabled: bool,
    pub file_storage_enabled: bool,
    pub is_server_key_validated: bool,
    pub backend_errors: Vec<BackendError>,
    pub two_factor_backup_codes_count: u8,
    pub people_search_sources: Vec<MediaSource>,
    pub exercise_parameters: ExerciseParameters,
    pub frontend: config_definition::FrontendConfig,
    pub provider_specifics: CoreDetailsProviderSpecifics,
    pub metadata_lot_source_mappings: Vec<MetadataLotSourceMappings>,
    pub provider_languages: Vec<ProviderLanguageInformation>,
    pub metadata_group_source_lot_mappings: Vec<MetadataGroupSourceLotMapping>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MetadataBaseData {
    pub model: metadata::Model,
    pub suggestions: Vec<String>,
    pub genres: Vec<GenreListItem>,
    pub creators: Vec<MetadataCreatorsGroupedByRole>,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
pub struct TmdbLanguage {
    pub iso_639_1: String,
    pub english_name: String,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
pub struct TmdbSettings {
    pub image_url: String,
    pub languages: Vec<TmdbLanguage>,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
pub struct TvdbLanguage {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize, Clone, SimpleObject)]
pub struct TvdbSettings {
    pub access_token: String,
    pub languages: Vec<TvdbLanguage>,
}
