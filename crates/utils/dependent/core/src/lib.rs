use std::sync::Arc;

use anilist_provider::AnilistService;
use anyhow::Result;
use audible_provider::AudibleService;
use common_models::BackendError;
use common_utils::{
    PAGE_SIZE, PEOPLE_SEARCH_SOURCES, TWO_FACTOR_BACKUP_CODES_COUNT, convert_naive_to_utc,
    get_base_http_client,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CoreDetails, CoreDetailsProviderSpecifics,
    ExerciseFilters, ExerciseParameters, ExerciseParametersLotMapping,
    MetadataGroupSourceLotMapping, MetadataLotSourceMappings, ProviderLanguageInformation,
    ProviderSupportedLanguageInformation,
};
use enum_meta::Meta;
use enum_models::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    MediaLot, MediaSource,
};
use env_utils::{APP_VERSION, UNKEY_ROOT_KEY};
use futures::try_join;
use igdb_provider::IgdbService;
use itertools::Itertools;
use itunes_provider::ITunesService;
use nest_struct::nest_struct;
use reqwest::header::{AUTHORIZATION, HeaderValue};
use sea_orm::{Iterable, prelude::Date};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use tmdb_provider::TmdbService;
use tvdb_provider::TvdbService;
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
    AnilistService,
    AudibleService,
    YoutubeMusicService,
)> {
    let (
        tmdb_service,
        tvdb_service,
        igdb_service,
        itunes_service,
        anilist_service,
        audible_service,
        youtube_music_service,
    ) = try_join!(
        TmdbService::new(ss.clone()),
        TvdbService::new(ss.clone()),
        IgdbService::new(ss.clone()),
        ITunesService::new(ss.clone()),
        AnilistService::new(&ss.config.anime_and_manga.anilist),
        AudibleService::new(&ss.config.audio_books.audible),
        YoutubeMusicService::new(),
    )?;
    Ok((
        tmdb_service,
        tvdb_service,
        igdb_service,
        itunes_service,
        anilist_service,
        audible_service,
        youtube_music_service,
    ))
}

fn build_provider_language_information(
    tmdb_service: &TmdbService,
    tvdb_service: &TvdbService,
    itunes_service: &ITunesService,
    audible_service: &AudibleService,
    anilist_service: &AnilistService,
    youtube_music_service: &YoutubeMusicService,
) -> Result<Vec<ProviderLanguageInformation>> {
    let information = MediaSource::iter()
        .map(|source| {
            let mut supported = match source {
                MediaSource::Tmdb => tmdb_service.get_all_languages(),
                MediaSource::Tvdb => tvdb_service.get_all_languages(),
                MediaSource::Itunes => itunes_service.get_all_languages(),
                MediaSource::Anilist => anilist_service.get_all_languages(),
                MediaSource::Audible => audible_service.get_all_languages(),
                MediaSource::YoutubeMusic => youtube_music_service.get_all_languages(),
                MediaSource::Igdb
                | MediaSource::Vndb
                | MediaSource::Custom
                | MediaSource::Spotify
                | MediaSource::GiantBomb
                | MediaSource::Hardcover
                | MediaSource::MusicBrainz
                | MediaSource::Myanimelist
                | MediaSource::GoogleBooks
                | MediaSource::Listennotes
                | MediaSource::Openlibrary
                | MediaSource::MangaUpdates => vec![ProviderSupportedLanguageInformation {
                    value: "us".to_owned(),
                    label: "us".to_owned(),
                }],
            };
            supported.sort_by(|a, b| a.label.cmp(&b.label));
            ProviderLanguageInformation { source, supported }
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

async fn get_is_server_key_validated(ss: &Arc<SupportingService>) -> Result<bool> {
    let pro_key = &ss.config.server.pro_key;
    if pro_key.is_empty() {
        return Ok(false);
    }
    #[nest_struct]
    #[derive(Debug, Serialize, Clone, Deserialize)]
    struct VerifyKeyResponse {
        data: nest! {
            valid: bool,
            meta: Option<nest! { expiry: Option<Date> }>
        },
    }
    let client = get_base_http_client(Some(vec![(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", UNKEY_ROOT_KEY)).unwrap(),
    )]));
    let Ok(request) = client
        .post("https://api.unkey.com/v2/keys.verifyKey")
        .json(&serde_json::json!({ "key": pro_key }))
        .send()
        .await
    else {
        tracing::warn!("Failed to verify Pro Key.");
        return Ok(false);
    };
    let Ok(response) = request.json::<VerifyKeyResponse>().await else {
        tracing::warn!("Failed to parse Pro Key verification response.");
        return Ok(false);
    };
    if !response.data.valid {
        tracing::debug!("Pro Key is no longer valid.");
        return Ok(false);
    };
    let key_meta = response.data.meta;
    tracing::debug!("Expiry: {:?}", key_meta.clone().map(|m| m.expiry));
    if let Some(meta) = key_meta
        && let Some(expiry) = meta.expiry
        && ss.server_start_time > convert_naive_to_utc(expiry)
    {
        tracing::warn!("Pro Key has expired. Please renew your subscription.");
        return Ok(false);
    }
    tracing::debug!("Pro Key verified successfully");
    Ok(true)
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
                anilist_service,
                audible_service,
                youtube_music_service,
            ) = create_providers(ss).await?;

            let (metadata_lot_source_mappings, metadata_group_source_lot_mappings) =
                build_metadata_mappings();
            let exercise_parameters = build_exercise_parameters();
            let provider_languages = build_provider_language_information(
                &tmdb_service,
                &tvdb_service,
                &itunes_service,
                &audible_service,
                &anilist_service,
                &youtube_music_service,
            )?;
            let provider_specifics = build_provider_specifics(&igdb_service).await?;

            let core_details = CoreDetails {
                provider_specifics,
                exercise_parameters,
                page_size: PAGE_SIZE,
                provider_languages,
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
                is_server_key_validated: get_is_server_key_validated(ss).await?,
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
