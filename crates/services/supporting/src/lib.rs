use std::sync::Arc;

use apalis::prelude::{MemoryStorage, MessageQueue};
use async_graphql::Result;
use background_models::{ApplicationJob, HpApplicationJob, LpApplicationJob, MpApplicationJob};
use bon::bon;
use cache_service::CacheService;
use chrono::{NaiveDate, TimeZone, Utc};
use common_models::BackendError;
use common_utils::{
    COMPILATION_TIMESTAMP, PAGE_SIZE, PEOPLE_SEARCH_SOURCES, convert_naive_to_utc, ryot_log,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CoreDetails, ExerciseFilters, ExerciseParameters,
    ExerciseParametersLotMapping, MetadataGroupSourceLotMapping, MetadataLotSourceMappings,
    ProviderLanguageInformation,
};
use enum_meta::Meta;
use enum_models::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    MediaLot, MediaSource,
};
use env_utils::{APP_VERSION, UNKEY_API_ID};
use file_storage_service::FileStorageService;
use itertools::Itertools;
use rustypipe::param::{LANGUAGES, Language};
use sea_orm::{DatabaseConnection, Iterable};
use serde::{Deserialize, Serialize};
use unkey::{Client, models::VerifyKeyRequest};

pub struct SupportingService {
    pub db: DatabaseConnection,
    pub timezone: chrono_tz::Tz,
    pub cache_service: CacheService,
    pub config: Arc<config::AppConfig>,
    pub file_storage_service: Arc<FileStorageService>,

    is_oidc_enabled: bool,
    lp_application_job: MemoryStorage<LpApplicationJob>,
    hp_application_job: MemoryStorage<HpApplicationJob>,
    mp_application_job: MemoryStorage<MpApplicationJob>,
}

#[bon]
impl SupportingService {
    #[builder]
    pub async fn new(
        is_oidc_enabled: bool,
        db: &DatabaseConnection,
        timezone: chrono_tz::Tz,
        cache_service: CacheService,
        config: Arc<config::AppConfig>,
        file_storage_service: Arc<FileStorageService>,
        lp_application_job: &MemoryStorage<LpApplicationJob>,
        mp_application_job: &MemoryStorage<MpApplicationJob>,
        hp_application_job: &MemoryStorage<HpApplicationJob>,
    ) -> Self {
        Self {
            config,
            timezone,
            cache_service,
            db: db.clone(),
            is_oidc_enabled,
            file_storage_service,
            lp_application_job: lp_application_job.clone(),
            mp_application_job: mp_application_job.clone(),
            hp_application_job: hp_application_job.clone(),
        }
    }

    pub async fn perform_application_job(&self, job: ApplicationJob) -> Result<()> {
        match job {
            ApplicationJob::Lp(job) => {
                self.lp_application_job.clone().enqueue(job).await.ok();
            }
            ApplicationJob::Hp(job) => {
                self.hp_application_job.clone().enqueue(job).await.ok();
            }
            ApplicationJob::Mp(job) => {
                self.mp_application_job.clone().enqueue(job).await.ok();
            }
        }
        Ok(())
    }

    async fn get_is_server_key_validated(&self) -> bool {
        let pro_key = &self.config.server.pro_key;
        if pro_key.is_empty() {
            return false;
        }
        ryot_log!(debug, "Verifying pro key for API ID: {:#?}", UNKEY_API_ID);
        let compile_timestamp = Utc.timestamp_opt(COMPILATION_TIMESTAMP, 0).unwrap();
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
        if let Some((_id, cached)) = cc.get_value(ApplicationCacheKey::CoreDetails).await {
            return Ok(cached);
        }
        let mut files_enabled = self.config.file_storage.is_enabled();
        if files_enabled && !self.file_storage_service.is_enabled().await {
            files_enabled = false;
        }
        let core_details = CoreDetails {
            page_size: PAGE_SIZE,
            version: APP_VERSION.to_owned(),
            oidc_enabled: self.is_oidc_enabled,
            file_storage_enabled: files_enabled,
            frontend: self.config.frontend.clone(),
            website_url: "https://ryot.io".to_owned(),
            docs_link: "https://docs.ryot.io".to_owned(),
            backend_errors: BackendError::iter().collect(),
            disable_telemetry: self.config.disable_telemetry,
            smtp_enabled: self.config.server.smtp.is_enabled(),
            signup_allowed: self.config.users.allow_registration,
            people_search_sources: PEOPLE_SEARCH_SOURCES.to_vec(),
            is_demo_instance: self.config.server.is_demo_instance,
            local_auth_disabled: self.config.users.disable_local_auth,
            token_valid_for_days: self.config.users.token_valid_for_days,
            repository_link: "https://github.com/ignisda/ryot".to_owned(),
            is_server_key_validated: self.get_is_server_key_validated().await,
            metadata_lot_source_mappings: MediaLot::iter()
                .map(|lot| MetadataLotSourceMappings {
                    lot,
                    sources: lot.meta(),
                })
                .collect(),
            metadata_group_source_lot_mappings: MediaSource::iter()
                .flat_map(|source| {
                    source
                        .meta()
                        .map(|lot| MetadataGroupSourceLotMapping { source, lot })
                })
                .collect(),
            exercise_parameters: ExerciseParameters {
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
                .collect(),
        };
        cc.set_key(
            ApplicationCacheKey::CoreDetails,
            ApplicationCacheValue::CoreDetails(Box::new(core_details.clone())),
        )
        .await?;
        Ok(core_details)
    }

    pub async fn is_server_key_validated(&self) -> Result<bool> {
        Ok(self.core_details().await?.is_server_key_validated)
    }
}
