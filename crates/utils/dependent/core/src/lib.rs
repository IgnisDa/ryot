use std::sync::Arc;

use anyhow::Result;
use audible_provider::AudibleService;
use common_models::BackendError;
use common_utils::{
    PAGE_SIZE, PEOPLE_SEARCH_SOURCES, TWO_FACTOR_BACKUP_CODES_COUNT, convert_naive_to_utc, ryot_log,
};
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
use env_utils::{APP_VERSION, UNKEY_API_ID};
use futures::try_join;
use igdb_provider::IgdbService;
use itertools::Itertools;
use itunes_provider::ITunesService;
use sea_orm::{Iterable, prelude::Date};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use tmdb_provider::TmdbService;
use tvdb_provider::TvdbService;
use unkey::{Client, models::VerifyKeyRequest};
use youtube_music_provider::YoutubeMusicService;

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

async fn create_providers(
    ss: &Arc<SupportingService>,
) -> Result<(
    TmdbService,
    TvdbService,
    IgdbService,
    ITunesService,
    AudibleService,
    YoutubeMusicService,
)> {
    let (
        tmdb_service,
        tvdb_service,
        igdb_service,
        youtube_music_service,
        itunes_service,
        audible_service,
    ) = try_join!(
        TmdbService::new(ss.clone()),
        TvdbService::new(ss.clone()),
        IgdbService::new(ss.clone()),
        YoutubeMusicService::new(),
        ITunesService::new(&ss.config.podcasts.itunes),
        AudibleService::new(&ss.config.audio_books.audible)
    )?;
    Ok((
        tmdb_service,
        tvdb_service,
        igdb_service,
        itunes_service,
        audible_service,
        youtube_music_service,
    ))
}

fn build_provider_language_information(
    tmdb_service: &TmdbService,
    tvdb_service: &TvdbService,
    itunes_service: &ITunesService,
    audible_service: &AudibleService,
    youtube_music_service: &YoutubeMusicService,
) -> Result<Vec<ProviderLanguageInformation>> {
    let information = MediaSource::iter()
        .map(|source| {
            let (supported, default) = match source {
                MediaSource::Tmdb => (
                    tmdb_service.get_all_languages(),
                    tmdb_service.get_default_language(),
                ),
                MediaSource::Tvdb => (
                    tvdb_service.get_all_languages(),
                    tvdb_service.get_default_language(),
                ),
                MediaSource::YoutubeMusic => (
                    youtube_music_service.get_all_languages(),
                    youtube_music_service.get_default_language(),
                ),
                MediaSource::Itunes => (
                    itunes_service.get_all_languages(),
                    itunes_service.get_default_language(),
                ),
                MediaSource::Audible => (
                    audible_service.get_all_languages(),
                    audible_service.get_default_language(),
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
        .collect();
    Ok(information)
}

async fn build_provider_specifics(
    igdb_service: &IgdbService,
) -> Result<CoreDetailsProviderSpecifics> {
    let mut specifics = CoreDetailsProviderSpecifics::default();

    if let Ok(igdb) = igdb_service.get_provider_specifics().await {
        specifics.igdb = igdb;
    }

    Ok(specifics)
}

async fn get_is_server_key_validated(ss: &Arc<SupportingService>) -> bool {
    let pro_key = &ss.config.server.pro_key;
    if pro_key.is_empty() {
        return false;
    }
    ryot_log!(debug, "Verifying Pro Key for API ID: {:#?}", UNKEY_API_ID);
    #[derive(Debug, Serialize, Clone, Deserialize)]
    struct Meta {
        expiry: Option<Date>,
    }
    let unkey_client = Client::new("public");
    let verify_request = VerifyKeyRequest::new(pro_key, &UNKEY_API_ID.to_string());
    let validated_key = match unkey_client.verify_key(verify_request).await {
        Ok(verify_response) => {
            if !verify_response.valid {
                ryot_log!(debug, "Pro Key is no longer valid.");
                return false;
            }
            verify_response
        }
        Err(verify_error) => {
            ryot_log!(debug, "Pro Key verification error: {:?}", verify_error);
            return false;
        }
    };
    let key_meta = validated_key
        .meta
        .map(|meta| serde_json::from_value::<Meta>(meta).unwrap());
    ryot_log!(debug, "Expiry: {:?}", key_meta.clone().map(|m| m.expiry));
    if let Some(meta) = key_meta {
        if let Some(expiry) = meta.expiry {
            if ss.server_start_time > convert_naive_to_utc(expiry) {
                ryot_log!(warn, "Pro Key has expired. Please renew your subscription.");
                return false;
            }
        }
    }
    ryot_log!(debug, "Pro Key verified successfully");
    true
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

            let (
                tmdb_service,
                tvdb_service,
                igdb_service,
                itunes_service,
                audible_service,
                youtube_music_service,
            ) = create_providers(ss).await?;

            let (metadata_lot_source_mappings, metadata_group_source_lot_mappings) =
                build_metadata_mappings();
            let exercise_parameters = build_exercise_parameters();
            let metadata_provider_languages = build_provider_language_information(
                &tmdb_service,
                &tvdb_service,
                &itunes_service,
                &audible_service,
                &youtube_music_service,
            )?;

            let provider_specifics = build_provider_specifics(&igdb_service).await?;

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
                is_server_key_validated: get_is_server_key_validated(ss).await,
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
