use std::{collections::HashMap, path::PathBuf, sync::Arc};

use async_graphql::{Error, Result};
use background_models::{ApplicationJob, MpApplicationJob};
use chrono::{DateTime, Utc};
use common_models::ExportJob;
use common_utils::{TEMPORARY_DIRECTORY, ryot_log};
use nanoid::nanoid;
use reqwest::{
    Body, Client,
    header::{CONTENT_LENGTH, CONTENT_TYPE},
};
use sea_orm::Iterable;
use struson::writer::{JsonStreamWriter, JsonWriter};
use supporting_service::SupportingService;
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};

use crate::collection_exports::CollectionExports;
use crate::export_utilities::ExportItem;
use crate::fitness_exports::FitnessExports;
use crate::media_exports::MediaExports;

pub struct JobManager {
    pub service: Arc<SupportingService>,
}

impl JobManager {
    pub fn new(service: Arc<SupportingService>) -> Self {
        Self { service }
    }

    pub async fn deploy_export_job(&self, user_id: String) -> Result<bool> {
        self.service
            .perform_application_job(ApplicationJob::Mp(MpApplicationJob::PerformExport(user_id)))
            .await?;
        Ok(true)
    }

    pub async fn user_exports(&self, user_id: String) -> Result<Vec<ExportJob>> {
        if !self.service.config.file_storage.is_enabled() {
            return Ok(vec![]);
        }
        let mut resp = vec![];
        let objects = self
            .service
            .file_storage_service
            .list_objects_at_prefix(format!("exports/{}", user_id))
            .await;
        for (size, key) in objects {
            let url = self
                .service
                .file_storage_service
                .get_presigned_url(key.clone())
                .await?;
            let metadata = self
                .service
                .file_storage_service
                .get_object_metadata(key.clone())
                .await;
            let started_at = DateTime::parse_from_rfc2822(metadata.get("started_at").unwrap())?
                .with_timezone(&Utc);
            let ended_at = DateTime::parse_from_rfc2822(metadata.get("ended_at").unwrap())?
                .with_timezone(&Utc);
            resp.push(ExportJob {
                size,
                url,
                key,
                ended_at,
                started_at,
            });
        }
        resp.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
        Ok(resp)
    }

    pub async fn perform_export(&self, user_id: String) -> Result<()> {
        if !self.service.config.file_storage.is_enabled() {
            return Err(Error::new(
                "File storage needs to be enabled to perform an export.",
            ));
        }
        let started_at = Utc::now();
        let export_path =
            PathBuf::from(TEMPORARY_DIRECTORY).join(format!("ryot-export-{}.json", nanoid!()));
        let file = std::fs::File::create(&export_path)?;
        let mut writer = JsonStreamWriter::new(file);
        writer.begin_object()?;

        let media_exports = MediaExports::new(self.service.clone());
        let fitness_exports = FitnessExports::new(self.service.clone());
        let collection_exports = CollectionExports::new(self.service.clone());

        for export in ExportItem::iter() {
            ryot_log!(debug, "Exporting {export}");
            writer.name(&export.to_string())?;
            writer.begin_array()?;
            match export {
                ExportItem::Metadata => media_exports.export_media(&user_id, &mut writer).await?,
                ExportItem::People => media_exports.export_people(&user_id, &mut writer).await?,
                ExportItem::MetadataGroups => {
                    media_exports
                        .export_media_group(&user_id, &mut writer)
                        .await?
                }
                ExportItem::Workouts => {
                    fitness_exports
                        .export_workouts(&user_id, &mut writer)
                        .await?
                }
                ExportItem::Exercises => {
                    fitness_exports
                        .export_exercises(&user_id, &mut writer)
                        .await?
                }
                ExportItem::Measurements => {
                    fitness_exports
                        .export_measurements(&user_id, &mut writer)
                        .await?
                }
                ExportItem::WorkoutTemplates => {
                    fitness_exports
                        .export_workout_templates(&user_id, &mut writer)
                        .await?
                }
                ExportItem::Collections => {
                    collection_exports
                        .export_collections(&user_id, &mut writer)
                        .await?
                }
            };
            writer.end_array()?;
        }
        writer.end_object()?;
        writer.finish_document()?;
        ryot_log!(debug, "Exporting completed");
        let ended_at = Utc::now();
        let (_key, url) = self
            .service
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
                ])),
            )
            .await;
        let file = File::open(&export_path).await?;
        let content_length = file.metadata().await?.len();
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
            .body(body)
            .send()
            .await?;
        Ok(())
    }
}
