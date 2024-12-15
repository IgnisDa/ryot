use std::sync::Arc;

use apalis::prelude::{MemoryStorage, MessageQueue};
use async_graphql::Result;
use background::{ApplicationJob, CoreApplicationJob};
use cache_service::CacheService;
use chrono::{NaiveDate, TimeZone, Utc};
use common_models::{ApplicationCacheKey, BackendError};
use common_utils::{
    convert_naive_to_utc, ryot_log, COMPILATION_TIMESTAMP, EXERCISE_LOT_MAPPINGS,
    MEDIA_LOT_MAPPINGS, PAGE_SIZE,
};
use database_models::prelude::Exercise;
use dependent_models::{
    ApplicationCacheValue, CoreDetails, ExerciseFilters, ExerciseParameters,
    ExerciseParametersLotMapping, MetadataLotSourceMappings, ProviderLanguageInformation,
};
use enums::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    MediaSource,
};
use env_utils::{APP_VERSION, UNKEY_API_ID};
use file_storage_service::FileStorageService;
use itertools::Itertools;
use openidconnect::core::CoreClient;
use rustypipe::param::{Language, LANGUAGES};
use sea_orm::{DatabaseConnection, EntityTrait, Iterable, PaginatorTrait};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use unkey::{models::VerifyKeyRequest, Client};

pub struct SupportingService {
    pub db: DatabaseConnection,
    pub timezone: chrono_tz::Tz,
    pub cache_service: CacheService,
    pub config: Arc<config::AppConfig>,
    pub oidc_client: Option<CoreClient>,
    pub file_storage_service: Arc<FileStorageService>,

    perform_application_job: MemoryStorage<ApplicationJob>,
    perform_core_application_job: MemoryStorage<CoreApplicationJob>,
}

impl SupportingService {
    #[allow(clippy::too_many_arguments)]
    pub async fn new(
        db: &DatabaseConnection,
        timezone: chrono_tz::Tz,
        cache_service: CacheService,
        config: Arc<config::AppConfig>,
        oidc_client: Option<CoreClient>,
        file_storage_service: Arc<FileStorageService>,
        perform_application_job: &MemoryStorage<ApplicationJob>,
        perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
    ) -> Self {
        Self {
            config,
            timezone,
            oidc_client,
            cache_service,
            db: db.clone(),
            file_storage_service,
            perform_application_job: perform_application_job.clone(),
            perform_core_application_job: perform_core_application_job.clone(),
        }
    }

    pub async fn perform_application_job(&self, job: ApplicationJob) -> Result<()> {
        self.perform_application_job
            .clone()
            .enqueue(job)
            .await
            .unwrap();
        Ok(())
    }

    pub async fn perform_core_application_job(&self, job: CoreApplicationJob) -> Result<()> {
        self.perform_core_application_job
            .clone()
            .enqueue(job)
            .await
            .unwrap();
        Ok(())
    }

    async fn get_is_server_key_validated(&self) -> bool {
        let pro_key = &self.config.server.pro_key;
        if pro_key.is_empty() {
            return false;
        }
        ryot_log!(debug, "Verifying pro key for API ID: {:#?}", UNKEY_API_ID);
        let compile_timestamp = Utc.timestamp_opt(COMPILATION_TIMESTAMP, 0).unwrap();
        #[skip_serializing_none]
        #[derive(Debug, Serialize, Clone, Deserialize)]
        struct Meta {
            expiry: Option<NaiveDate>,
        }
        let unkey_client = Client::new("public");
        let verify_request = VerifyKeyRequest::new(pro_key, &UNKEY_API_ID.to_string());
        let validated_key = match unkey_client.verify_key(verify_request).await {
            Ok(verify_response) => {
                if !verify_response.valid {
                    ryot_log!(debug, "Pro key is no longer valid.");
                    return false;
                }
                verify_response
            }
            Err(verify_error) => {
                ryot_log!(debug, "Pro key verification error: {:?}", verify_error);
                return false;
            }
        };
        let key_meta = validated_key
            .meta
            .map(|meta| serde_json::from_value::<Meta>(meta).unwrap());
        ryot_log!(debug, "Expiry: {:?}", key_meta.clone().map(|m| m.expiry));
        if let Some(meta) = key_meta {
            if let Some(expiry) = meta.expiry {
                if compile_timestamp > convert_naive_to_utc(expiry) {
                    ryot_log!(warn, "Pro key has expired. Please renew your subscription.");
                    return false;
                }
            }
        }
        ryot_log!(debug, "Pro key verified successfully");
        true
    }

    pub async fn core_details(&self) -> Result<CoreDetails> {
        let cc = &self.cache_service;
        if let Some(cached) = cc.get_value(ApplicationCacheKey::CoreDetails).await? {
            return Ok(cached);
        }
        let mut files_enabled = self.config.file_storage.is_enabled();
        if files_enabled && !self.file_storage_service.is_enabled().await {
            files_enabled = false;
        }
        let download_required = Exercise::find().count(&self.db).await? == 0;
        let core_details = CoreDetails {
            page_size: PAGE_SIZE,
            version: APP_VERSION.to_owned(),
            file_storage_enabled: files_enabled,
            frontend: self.config.frontend.clone(),
            website_url: "https://ryot.io".to_owned(),
            oidc_enabled: self.oidc_client.is_some(),
            docs_link: "https://docs.ryot.io".to_owned(),
            backend_errors: BackendError::iter().collect(),
            disable_telemetry: self.config.disable_telemetry,
            smtp_enabled: self.config.server.smtp.is_enabled(),
            signup_allowed: self.config.users.allow_registration,
            local_auth_disabled: self.config.users.disable_local_auth,
            token_valid_for_days: self.config.users.token_valid_for_days,
            repository_link: "https://github.com/ignisda/ryot".to_owned(),
            is_server_key_validated: self.get_is_server_key_validated().await,
            metadata_lot_source_mappings: MEDIA_LOT_MAPPINGS
                .iter()
                .map(|(lot, sources)| MetadataLotSourceMappings {
                    lot: *lot,
                    sources: sources.to_vec(),
                })
                .collect(),
            exercise_parameters: ExerciseParameters {
                download_required,
                filters: ExerciseFilters {
                    lot: ExerciseLot::iter().collect_vec(),
                    level: ExerciseLevel::iter().collect_vec(),
                    force: ExerciseForce::iter().collect_vec(),
                    mechanic: ExerciseMechanic::iter().collect_vec(),
                    equipment: ExerciseEquipment::iter().collect_vec(),
                    muscle: ExerciseMuscle::iter().collect_vec(),
                },
                lot_mapping: EXERCISE_LOT_MAPPINGS
                    .iter()
                    .map(|(lot, pbs)| ExerciseParametersLotMapping {
                        lot: *lot,
                        bests: pbs.to_vec(),
                    })
                    .collect(),
            },
            metadata_provider_languages: MediaSource::iter()
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
                        MediaSource::Openlibrary => (
                            ["us"].into_iter().map(String::from).collect(),
                            "us".to_owned(),
                        ),
                        MediaSource::Tmdb => (
                            isolang::languages()
                                .filter_map(|l| l.to_639_1().map(String::from))
                                .collect(),
                            "en".to_owned(),
                        ),
                        MediaSource::Listennotes => (
                            ["us"].into_iter().map(String::from).collect(),
                            "us".to_owned(),
                        ),
                        MediaSource::GoogleBooks => (vec!["us".to_owned()], "us".to_owned()),
                        MediaSource::Igdb => (
                            ["us"].into_iter().map(String::from).collect(),
                            "us".to_owned(),
                        ),
                        MediaSource::MangaUpdates => (
                            ["us"].into_iter().map(String::from).collect(),
                            "us".to_owned(),
                        ),
                        MediaSource::Anilist => (
                            ["us"].into_iter().map(String::from).collect(),
                            "us".to_owned(),
                        ),
                        MediaSource::Mal => (
                            ["us"].into_iter().map(String::from).collect(),
                            "us".to_owned(),
                        ),
                        MediaSource::Custom => (
                            ["us"].into_iter().map(String::from).collect(),
                            "us".to_owned(),
                        ),
                        MediaSource::Vndb => (
                            ["us"].into_iter().map(String::from).collect(),
                            "us".to_owned(),
                        ),
                    };
                    ProviderLanguageInformation {
                        source,
                        default,
                        supported,
                    }
                })
                .collect(),
        };
        cc.set_key(
            ApplicationCacheKey::CoreDetails,
            ApplicationCacheValue::CoreDetails(core_details.clone()),
        )
        .await?;
        Ok(core_details)
    }

    pub async fn is_server_key_validated(&self) -> Result<bool> {
        Ok(self.core_details().await?.is_server_key_validated)
    }
}
