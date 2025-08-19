use std::sync::Arc;

use anyhow::Result;
use common_models::BackendError;
use common_utils::{PAGE_SIZE, PEOPLE_SEARCH_SOURCES, TWO_FACTOR_BACKUP_CODES_COUNT};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CoreDetails, CoreDetailsProviderSpecifics,
    ExerciseFilters, ExerciseParameters, ExerciseParametersLotMapping,
    MetadataGroupSourceLotMapping, MetadataLotSourceMappings, ProviderLanguageInformation,
};
use enum_meta::Meta;
use enum_models::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    MediaLot, MediaSource,
};
use env_utils::APP_VERSION;
use igdb_provider::IgdbService;
use itertools::Itertools;
use rustypipe::param::{LANGUAGES, Language};
use sea_orm::Iterable;
use supporting_service::SupportingService;

fn build_metadata_mappings() -> (
    Vec<MetadataLotSourceMappings>,
    Vec<MetadataGroupSourceLotMapping>,
) {
    let metadata_lot_source_mappings = MediaLot::iter()
        .map(|lot| MetadataLotSourceMappings {
            lot,
            sources: lot.meta(),
        })
        .collect();

    let metadata_group_source_lot_mappings = MediaSource::iter()
        .flat_map(|source| {
            source
                .meta()
                .map(|lot| MetadataGroupSourceLotMapping { source, lot })
        })
        .collect();

    (
        metadata_lot_source_mappings,
        metadata_group_source_lot_mappings,
    )
}

fn build_exercise_parameters() -> ExerciseParameters {
    ExerciseParameters {
        filters: ExerciseFilters {
            lot: ExerciseLot::iter().collect_vec(),
            level: ExerciseLevel::iter().collect_vec(),
            force: ExerciseForce::iter().collect_vec(),
            muscle: ExerciseMuscle::iter().collect_vec(),
            mechanic: ExerciseMechanic::iter().collect_vec(),
            equipment: ExerciseEquipment::iter().collect_vec(),
        },
        lot_mapping: ExerciseLot::iter()
            .map(|lot| ExerciseParametersLotMapping {
                lot,
                bests: lot.meta(),
            })
            .collect(),
    }
}

fn build_provider_language_information() -> Vec<ProviderLanguageInformation> {
    MediaSource::iter()
        .map(|source| {
            let (supported, default) = match source {
                MediaSource::YoutubeMusic => (
                    LANGUAGES.iter().map(|l| l.name().to_owned()).collect(),
                    Language::En.name().to_owned(),
                ),
                MediaSource::Itunes => (
                    ["en_us", "ja_jp"].into_iter().map(String::from).collect(),
                    "en_us".to_owned(),
                ),
                MediaSource::Audible => (
                    ["au", "ca", "de", "es", "fr", "in", "it", "jp", "gb", "us"]
                        .into_iter()
                        .map(String::from)
                        .collect(),
                    "us".to_owned(),
                ),
                MediaSource::Tmdb => (
                    isolang::languages()
                        .filter_map(|l| l.to_639_1().map(String::from))
                        .collect(),
                    "en".to_owned(),
                ),
                MediaSource::Igdb
                | MediaSource::Vndb
                | MediaSource::Custom
                | MediaSource::Anilist
                | MediaSource::Spotify
                | MediaSource::GiantBomb
                | MediaSource::Hardcover
                | MediaSource::Myanimelist
                | MediaSource::GoogleBooks
                | MediaSource::Listennotes
                | MediaSource::Openlibrary
                | MediaSource::MangaUpdates => (vec!["us".to_owned()], "us".to_owned()),
            };
            ProviderLanguageInformation {
                source,
                default,
                supported,
            }
        })
        .collect()
}

async fn build_provider_specifics(
    ss: &Arc<SupportingService>,
) -> Result<CoreDetailsProviderSpecifics> {
    let service = IgdbService::new(ss.clone()).await?;
    let igdb = service.get_provider_specifics().await?;

    Ok(CoreDetailsProviderSpecifics { igdb })
}

pub async fn core_details(ss: &Arc<SupportingService>) -> Result<CoreDetails> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::CoreDetails,
        |data| ApplicationCacheValue::CoreDetails(Box::new(data)),
        || async {
            let mut files_enabled = ss.config.file_storage.is_enabled();
            if files_enabled && !file_storage_service::is_enabled(ss).await {
                files_enabled = false;
            }

            let (metadata_lot_source_mappings, metadata_group_source_lot_mappings) =
                build_metadata_mappings();
            let exercise_parameters = build_exercise_parameters();
            let metadata_provider_languages = build_provider_language_information();
            let provider_specifics = build_provider_specifics(ss).await?;

            let core_details = CoreDetails {
                provider_specifics,
                exercise_parameters,
                page_size: PAGE_SIZE,
                metadata_provider_languages,
                metadata_lot_source_mappings,
                version: APP_VERSION.to_owned(),
                oidc_enabled: ss.is_oidc_enabled,
                metadata_group_source_lot_mappings,
                file_storage_enabled: files_enabled,
                frontend: ss.config.frontend.clone(),
                website_url: "https://ryot.io".to_owned(),
                docs_link: "https://docs.ryot.io".to_owned(),
                backend_errors: BackendError::iter().collect(),
                disable_telemetry: ss.config.disable_telemetry,
                smtp_enabled: ss.config.server.smtp.is_enabled(),
                signup_allowed: ss.config.users.allow_registration,
                max_file_size_mb: ss.config.server.max_file_size_mb,
                people_search_sources: PEOPLE_SEARCH_SOURCES.to_vec(),
                is_demo_instance: ss.config.server.is_demo_instance,
                local_auth_disabled: ss.config.users.disable_local_auth,
                token_valid_for_days: ss.config.users.token_valid_for_days,
                two_factor_backup_codes_count: TWO_FACTOR_BACKUP_CODES_COUNT,
                repository_link: "https://github.com/ignisda/ryot".to_owned(),
                is_server_key_validated: ss.get_is_server_key_validated().await,
            };
            Ok(core_details)
        },
    )
    .await
    .map(|c| c.response)
}

pub async fn is_server_key_validated(ss: &Arc<SupportingService>) -> Result<bool> {
    Ok(core_details(ss).await?.is_server_key_validated)
}
