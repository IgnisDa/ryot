use std::{collections::HashMap, path::PathBuf, sync::Arc};

use apalis::prelude::MessageQueue;
use async_graphql::{Context, Error, Object, Result, SimpleObject};
use chrono::{DateTime, Utc};
use models::ExportItem;
use nanoid::nanoid;
use reqwest::{
    header::{CONTENT_LENGTH, CONTENT_TYPE},
    Body, Client,
};
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use services::FileStorageService;
use struson::writer::{JsonStreamWriter, JsonWriter};
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};
use traits::AuthProvider;
use utils::IsFeatureEnabled;

use crate::{
    app_utils::TEMP_DIR, background::ApplicationJob, fitness::resolver::ExerciseService,
    miscellaneous::MiscellaneousService,
};

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
struct ExportJob {
    started_at: DateTimeUtc,
    ended_at: DateTimeUtc,
    exported: Vec<ExportItem>,
    url: String,
}

#[derive(Default)]
pub struct ExporterQuery;

impl AuthProvider for ExporterQuery {}

#[Object]
impl ExporterQuery {
    /// Get all the export jobs for the current user.
    async fn user_exports(&self, gql_ctx: &Context<'_>) -> Result<Vec<ExportJob>> {
        let service = gql_ctx.data_unchecked::<Arc<ExporterService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.user_exports(user_id).await
    }
}

#[derive(Default)]
pub struct ExporterMutation;

impl AuthProvider for ExporterMutation {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl ExporterMutation {
    /// Deploy a job to export data for a user.
    async fn deploy_export_job(
        &self,
        gql_ctx: &Context<'_>,
        to_export: Vec<ExportItem>,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExporterService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        service.deploy_export_job(user_id, to_export).await
    }
}

pub struct ExporterService {
    config: Arc<config::AppConfig>,
    file_storage_service: Arc<FileStorageService>,
    media_service: Arc<MiscellaneousService>,
    exercise_service: Arc<ExerciseService>,
}

impl ExporterService {
    pub fn new(
        config: Arc<config::AppConfig>,
        file_storage_service: Arc<FileStorageService>,
        media_service: Arc<MiscellaneousService>,
        exercise_service: Arc<ExerciseService>,
    ) -> Self {
        Self {
            config,
            file_storage_service,
            media_service,
            exercise_service,
        }
    }

    async fn deploy_export_job(&self, user_id: String, to_export: Vec<ExportItem>) -> Result<bool> {
        self.media_service
            .perform_application_job
            .clone()
            .enqueue(ApplicationJob::PerformExport(user_id, to_export))
            .await
            .unwrap();
        Ok(true)
    }

    pub async fn perform_export(
        &self,
        user_id: String,
        to_export: Vec<ExportItem>,
    ) -> Result<bool> {
        if !self.config.file_storage.is_enabled() {
            return Err(Error::new(
                "File storage needs to be enabled to perform an export.",
            ));
        }
        let started_at = Utc::now();
        let export_path = PathBuf::from(TEMP_DIR).join(format!("ryot-export-{}.json", nanoid!()));
        let file = std::fs::File::create(&export_path).unwrap();
        let mut writer = JsonStreamWriter::new(file);
        writer.begin_object().unwrap();
        for export in to_export.iter() {
            writer.name(&export.to_string())?;
            writer.begin_array().unwrap();
            match export {
                ExportItem::Media => {
                    self.media_service
                        .export_media(&user_id, &mut writer)
                        .await?;
                }
                ExportItem::MediaGroup => {
                    self.media_service
                        .export_media_group(&user_id, &mut writer)
                        .await?;
                }
                ExportItem::People => {
                    self.media_service
                        .export_people(&user_id, &mut writer)
                        .await?;
                }
                ExportItem::Measurements => {
                    self.exercise_service
                        .export_measurements(&user_id, &mut writer)
                        .await?;
                }
                ExportItem::Workouts => {
                    self.exercise_service
                        .export_workouts(&user_id, &mut writer)
                        .await?;
                }
            };
            writer.end_array().unwrap();
        }
        writer.end_object().unwrap();
        writer.finish_document().unwrap();
        let ended_at = Utc::now();
        let (_key, url) = self
            .file_storage_service
            .get_presigned_put_url(
                export_path
                    .file_name()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_string(),
                format!("exports/{}", user_id),
                false,
                Some(HashMap::from([
                    ("started_at".to_string(), started_at.to_rfc2822()),
                    ("ended_at".to_string(), ended_at.to_rfc2822()),
                    (
                        "exported".to_string(),
                        serde_json::to_string(&to_export).unwrap(),
                    ),
                ])),
            )
            .await;
        let file = File::open(&export_path).await.unwrap();
        let content_length = file.metadata().await.unwrap().len();
        let content_type = mime_guess::from_path(&export_path).first_or_octet_stream();
        let stream = FramedRead::new(file, BytesCodec::new());
        let body = Body::wrap_stream(stream);
        let client = Client::new();
        client
            .put(url)
            .header(CONTENT_TYPE, content_type.to_string())
            .header(CONTENT_LENGTH, content_length)
            .header("x-amz-meta-started_at", started_at.to_rfc2822())
            .header("x-amz-meta-ended_at", ended_at.to_rfc2822())
            .header(
                "x-amz-meta-exported",
                serde_json::to_string(&to_export).unwrap(),
            )
            .body(body)
            .send()
            .await
            .unwrap();
        Ok(true)
    }

    async fn user_exports(&self, user_id: String) -> Result<Vec<ExportJob>> {
        if !self.config.file_storage.is_enabled() {
            return Ok(vec![]);
        }
        let mut resp = vec![];
        let objects = self
            .file_storage_service
            .list_objects_at_prefix(format!("exports/{}", user_id))
            .await;
        for object in objects {
            let url = self
                .file_storage_service
                .get_presigned_url(object.clone())
                .await;
            let metadata = self.file_storage_service.get_object_metadata(object).await;
            let started_at = DateTime::parse_from_rfc2822(metadata.get("started_at").unwrap())
                .unwrap()
                .with_timezone(&Utc);
            let ended_at = DateTime::parse_from_rfc2822(metadata.get("ended_at").unwrap())
                .unwrap()
                .with_timezone(&Utc);
            let exported: Vec<ExportItem> =
                serde_json::from_str(metadata.get("exported").unwrap()).unwrap();
            let exp = ExportJob {
                url,
                started_at,
                ended_at,
                exported,
            };
            resp.push(exp);
        }
        resp.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
        Ok(resp)
    }
}
