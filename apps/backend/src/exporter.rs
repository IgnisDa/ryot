use std::{collections::HashMap, fs::File as StdFile, path::PathBuf, sync::Arc};

use apalis::prelude::{MemoryStorage, MessageQueue};
use async_graphql::{Context, Error, Object, Result, SimpleObject};
use chrono::{DateTime, Utc};
use models::{
    prelude::{Metadata, MetadataGroup, Person, Review, Seen, UserToEntity, Workout},
    review, seen, user_to_entity, workout, ExportItem, ImportOrExportMediaGroupItem,
    ImportOrExportMediaItem, ImportOrExportMediaItemSeen, ImportOrExportPersonItem,
    UserMeasurementsListInput,
};
use nanoid::nanoid;
use reqwest::{
    header::{CONTENT_LENGTH, CONTENT_TYPE},
    Body, Client,
};
use sea_orm::{
    prelude::DateTimeUtc, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use serde::{Deserialize, Serialize};
use services::FileStorageService;
use struson::writer::{JsonStreamWriter, JsonWriter};
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};
use traits::AuthProvider;
use utils::{IsFeatureEnabled, TEMP_DIR};

use crate::{
    app_utils::{
        entity_in_collections, get_review_export_item, review_by_id, user_measurements_list,
        workout_details,
    },
    background::ApplicationJob,
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
    db: DatabaseConnection,
    config: Arc<config::AppConfig>,
    file_storage_service: Arc<FileStorageService>,
    perform_application_job: MemoryStorage<ApplicationJob>,
}

impl ExporterService {
    pub fn new(
        db: &DatabaseConnection,
        config: Arc<config::AppConfig>,
        perform_application_job: &MemoryStorage<ApplicationJob>,
        file_storage_service: Arc<FileStorageService>,
    ) -> Self {
        Self {
            db: db.clone(),
            config,
            file_storage_service,
            perform_application_job: perform_application_job.clone(),
        }
    }

    async fn deploy_export_job(&self, user_id: String, to_export: Vec<ExportItem>) -> Result<bool> {
        self.perform_application_job
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
                    self.export_media(&user_id, &mut writer).await?;
                }
                ExportItem::MediaGroup => {
                    self.export_media_group(&user_id, &mut writer).await?;
                }
                ExportItem::People => {
                    self.export_people(&user_id, &mut writer).await?;
                }
                ExportItem::Measurements => {
                    self.export_measurements(&user_id, &mut writer).await?;
                }
                ExportItem::Workouts => {
                    self.export_workouts(&user_id, &mut writer).await?;
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

    async fn export_media(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<bool> {
        let related_metadata = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::MetadataId.is_not_null())
            .all(&self.db)
            .await
            .unwrap();
        for rm in related_metadata.iter() {
            let m = rm
                .find_related(Metadata)
                .one(&self.db)
                .await
                .unwrap()
                .unwrap();
            let seen_history = m
                .find_related(Seen)
                .filter(seen::Column::UserId.eq(user_id))
                .all(&self.db)
                .await
                .unwrap();
            let seen_history = seen_history
                .into_iter()
                .map(|s| {
                    let (show_season_number, show_episode_number) = match s.show_extra_information {
                        Some(d) => (Some(d.season), Some(d.episode)),
                        None => (None, None),
                    };
                    let podcast_episode_number = s.podcast_extra_information.map(|d| d.episode);
                    let anime_episode_number = s.anime_extra_information.and_then(|d| d.episode);
                    let manga_chapter_number =
                        s.manga_extra_information.clone().and_then(|d| d.chapter);
                    let manga_volume_number = s.manga_extra_information.and_then(|d| d.volume);
                    ImportOrExportMediaItemSeen {
                        progress: Some(s.progress),
                        started_on: s.started_on,
                        ended_on: s.finished_on,
                        provider_watched_on: s.provider_watched_on,
                        show_season_number,
                        show_episode_number,
                        podcast_episode_number,
                        anime_episode_number,
                        manga_chapter_number,
                        manga_volume_number,
                    }
                })
                .collect();
            let db_reviews = m
                .find_related(Review)
                .filter(review::Column::UserId.eq(user_id))
                .all(&self.db)
                .await
                .unwrap();
            let mut reviews = vec![];
            for review in db_reviews {
                let review_item = get_review_export_item(
                    review_by_id(&self.db, review.id, user_id, false)
                        .await
                        .unwrap(),
                );
                reviews.push(review_item);
            }
            let collections =
                entity_in_collections(&self.db, user_id, Some(m.id), None, None, None, None)
                    .await?
                    .into_iter()
                    .map(|c| c.name)
                    .collect();
            let exp = ImportOrExportMediaItem {
                source_id: m.title,
                lot: m.lot,
                source: m.source,
                identifier: m.identifier.clone(),
                seen_history,
                reviews,
                collections,
            };
            writer.serialize_value(&exp).unwrap();
        }
        Ok(true)
    }

    async fn export_media_group(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<bool> {
        let related_metadata = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::MetadataGroupId.is_not_null())
            .all(&self.db)
            .await
            .unwrap();
        for rm in related_metadata.iter() {
            let m = rm
                .find_related(MetadataGroup)
                .one(&self.db)
                .await
                .unwrap()
                .unwrap();
            let db_reviews = m
                .find_related(Review)
                .filter(review::Column::UserId.eq(user_id))
                .all(&self.db)
                .await
                .unwrap();
            let mut reviews = vec![];
            for review in db_reviews {
                let review_item = get_review_export_item(
                    review_by_id(&self.db, review.id, user_id, false)
                        .await
                        .unwrap(),
                );
                reviews.push(review_item);
            }
            let collections =
                entity_in_collections(&self.db, user_id, None, None, Some(m.id), None, None)
                    .await?
                    .into_iter()
                    .map(|c| c.name)
                    .collect();
            let exp = ImportOrExportMediaGroupItem {
                title: m.title,
                lot: m.lot,
                source: m.source,
                identifier: m.identifier.clone(),
                reviews,
                collections,
            };
            writer.serialize_value(&exp).unwrap();
        }
        Ok(true)
    }

    async fn export_people(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<bool> {
        let related_people = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::PersonId.is_not_null())
            .all(&self.db)
            .await
            .unwrap();
        for rm in related_people.iter() {
            let p = rm
                .find_related(Person)
                .one(&self.db)
                .await
                .unwrap()
                .unwrap();
            let db_reviews = p
                .find_related(Review)
                .filter(review::Column::UserId.eq(user_id))
                .all(&self.db)
                .await
                .unwrap();
            let mut reviews = vec![];
            for review in db_reviews {
                let review_item = get_review_export_item(
                    review_by_id(&self.db, review.id, user_id, false)
                        .await
                        .unwrap(),
                );
                reviews.push(review_item);
            }
            let collections =
                entity_in_collections(&self.db, user_id, None, Some(p.id), None, None, None)
                    .await?
                    .into_iter()
                    .map(|c| c.name)
                    .collect();
            let exp = ImportOrExportPersonItem {
                identifier: p.identifier,
                source: p.source,
                source_specifics: p.source_specifics,
                name: p.name,
                reviews,
                collections,
            };
            writer.serialize_value(&exp).unwrap();
        }
        Ok(true)
    }

    async fn export_workouts(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<bool> {
        let workout_ids = Workout::find()
            .select_only()
            .column(workout::Column::Id)
            .filter(workout::Column::UserId.eq(user_id))
            .order_by_desc(workout::Column::EndTime)
            .into_tuple::<String>()
            .all(&self.db)
            .await?;
        for workout_id in workout_ids {
            let details =
                workout_details(&self.db, &self.file_storage_service, user_id, workout_id).await?;
            writer.serialize_value(&details).unwrap();
        }
        Ok(true)
    }

    async fn export_measurements(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<bool> {
        let measurements = user_measurements_list(
            &self.db,
            user_id,
            UserMeasurementsListInput {
                start_time: None,
                end_time: None,
            },
        )
        .await?;
        for measurement in measurements {
            writer.serialize_value(&measurement).unwrap();
        }
        Ok(true)
    }
}
