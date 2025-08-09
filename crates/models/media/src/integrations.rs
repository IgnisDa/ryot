use async_graphql::{InputObject, SimpleObject, Union};
use enum_models::{
    IntegrationProvider, MediaLot, MediaSource, NotificationPlatformLot,
    UserNotificationContentDiscriminants,
};
use rust_decimal::Decimal;
use schematic::Schematic;
use sea_orm::FromJsonQueryResult;
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;

use crate::{SeenShowExtraInformation, UniqueMediaIdentifier};

#[derive(Debug, Clone, SimpleObject)]
pub struct TmdbMetadataLookupResult {
    pub lot: MediaLot,
    pub title: String,
    pub identifier: String,
    pub publish_year: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, SimpleObject)]
pub struct MetadataLookupFoundResult {
    pub data: UniqueMediaIdentifier,
    pub show_information: Option<SeenShowExtraInformation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, SimpleObject)]
pub struct MetadataLookupNotFound {
    pub not_found: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Union)]
pub enum MetadataLookupResponse {
    Found(MetadataLookupFoundResult),
    NotFound(MetadataLookupNotFound),
}

#[skip_serializing_none]
#[derive(
    Eq,
    Debug,
    Clone,
    Default,
    PartialEq,
    Serialize,
    InputObject,
    Deserialize,
    SimpleObject,
    FromJsonQueryResult,
)]
#[graphql(input_name = "IntegrationExtraSettingsInput")]
pub struct IntegrationExtraSettings {
    pub disable_on_continuous_errors: bool,
}

#[skip_serializing_none]
#[derive(
    Debug,
    Serialize,
    Deserialize,
    InputObject,
    Clone,
    SimpleObject,
    FromJsonQueryResult,
    Eq,
    PartialEq,
    Hash,
    Default,
    Schematic,
)]
#[graphql(input_name = "IntegrationSourceSpecificsInput")]
#[serde(rename_all = "snake_case")]
pub struct IntegrationProviderSpecifics {
    pub plex_yank_token: Option<String>,
    pub plex_yank_base_url: Option<String>,

    pub plex_sink_username: Option<String>,

    pub audiobookshelf_token: Option<String>,
    pub audiobookshelf_base_url: Option<String>,

    pub komga_base_url: Option<String>,
    pub komga_username: Option<String>,
    pub komga_password: Option<String>,
    pub komga_provider: Option<MediaSource>,

    pub radarr_api_key: Option<String>,
    pub radarr_profile_id: Option<i32>,
    pub radarr_base_url: Option<String>,
    pub radarr_tag_ids: Option<Vec<i32>>,
    pub radarr_root_folder_path: Option<String>,
    pub radarr_sync_collection_ids: Option<Vec<String>>,

    pub sonarr_profile_id: Option<i32>,
    pub sonarr_api_key: Option<String>,
    pub sonarr_base_url: Option<String>,
    pub sonarr_tag_ids: Option<Vec<i32>>,
    pub sonarr_root_folder_path: Option<String>,
    pub sonarr_sync_collection_ids: Option<Vec<String>>,

    pub jellyfin_push_base_url: Option<String>,
    pub jellyfin_push_username: Option<String>,
    pub jellyfin_push_password: Option<String>,

    pub youtube_music_timezone: Option<String>,
    pub youtube_music_auth_cookie: Option<String>,

    pub ryot_browser_extension_disabled_sites: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateOrUpdateUserIntegrationInput {
    pub name: Option<String>,
    pub is_disabled: Option<bool>,
    pub integration_id: Option<String>,
    pub minimum_progress: Option<Decimal>,
    pub maximum_progress: Option<Decimal>,
    pub provider: Option<IntegrationProvider>,
    pub sync_to_owned_collection: Option<bool>,
    pub extra_settings: IntegrationExtraSettings,
    pub provider_specifics: Option<IntegrationProviderSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateUserNotificationPlatformInput {
    pub priority: Option<i32>,
    pub chat_id: Option<String>,
    pub base_url: Option<String>,
    #[graphql(secret)]
    pub api_token: Option<String>,
    #[graphql(secret)]
    pub auth_header: Option<String>,
    pub lot: NotificationPlatformLot,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct UpdateUserNotificationPlatformInput {
    pub notification_id: String,
    pub is_disabled: Option<bool>,
    pub configured_events: Option<Vec<UserNotificationContentDiscriminants>>,
}
