use std::{collections::HashMap, fs::File as StdFile, path::PathBuf, sync::Arc};

use async_graphql::{Error, Result};
use background_models::{ApplicationJob, MpApplicationJob};
use chrono::{DateTime, Utc};
use common_models::{ExportJob, SearchInput};
use common_utils::{ryot_log, TEMP_DIR};
use database_models::{
    exercise,
    prelude::{
        Exercise, Metadata, MetadataGroup, Person, Seen, UserToEntity, Workout, WorkoutTemplate,
    },
    seen, user_to_entity, workout, workout_template,
};
use database_utils::{
    entity_in_collections, item_reviews, user_measurements_list, user_workout_details,
    user_workout_template_details,
};
use dependent_models::{ImportOrExportWorkoutItem, ImportOrExportWorkoutTemplateItem};
use dependent_utils::metadata_list;
use enum_models::EntityLot;
use fitness_models::UserMeasurementsListInput;
use itertools::Itertools;
use media_models::{
    ImportOrExportExerciseItem, ImportOrExportItemRating, ImportOrExportItemReview,
    ImportOrExportMetadataGroupItem, ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen,
    ImportOrExportPersonItem, MetadataListInput, ReviewItem,
};
use nanoid::nanoid;
use reqwest::{
    header::{CONTENT_LENGTH, CONTENT_TYPE},
    Body, Client,
};
use sea_orm::{
    strum::Display, ColumnTrait, EntityTrait, EnumIter, Iterable, ModelTrait, QueryFilter,
    QueryOrder, QuerySelect,
};
use struson::writer::{JsonStreamWriter, JsonWriter};
use supporting_service::SupportingService;
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};

#[derive(Eq, PartialEq, Copy, Display, Clone, Debug, EnumIter)]
#[strum(serialize_all = "snake_case")]
enum ExportItem {
    Media,
    People,
    Workouts,
    Exercises,
    MediaGroups,
    Measurements,
    WorkoutTemplates,
}

pub struct ExporterService(pub Arc<SupportingService>);

impl ExporterService {
    pub async fn deploy_export_job(&self, user_id: String) -> Result<bool> {
        self.0
            .perform_application_job(ApplicationJob::Mp(MpApplicationJob::PerformExport(user_id)))
            .await?;
        Ok(true)
    }

    pub async fn user_exports(&self, user_id: String) -> Result<Vec<ExportJob>> {
        if !self.0.config.file_storage.is_enabled() {
            return Ok(vec![]);
        }
        let mut resp = vec![];
        let objects = self
            .0
            .file_storage_service
            .list_objects_at_prefix(format!("exports/{}", user_id))
            .await;
        for (size, object_key) in objects {
            let url = self
                .0
                .file_storage_service
                .get_presigned_url(object_key.clone())
                .await;
            let metadata = self
                .0
                .file_storage_service
                .get_object_metadata(object_key)
                .await;
            let started_at = DateTime::parse_from_rfc2822(metadata.get("started_at").unwrap())
                .unwrap()
                .with_timezone(&Utc);
            let ended_at = DateTime::parse_from_rfc2822(metadata.get("ended_at").unwrap())
                .unwrap()
                .with_timezone(&Utc);
            let exp = ExportJob {
                size,
                url,
                ended_at,
                started_at,
            };
            resp.push(exp);
        }
        resp.sort_by(|a, b| b.ended_at.cmp(&a.ended_at));
        Ok(resp)
    }

    pub async fn perform_export(&self, user_id: String) -> Result<()> {
        if !self.0.config.file_storage.is_enabled() {
            return Err(Error::new(
                "File storage needs to be enabled to perform an export.",
            ));
        }
        let started_at = Utc::now();
        let export_path = PathBuf::from(TEMP_DIR).join(format!("ryot-export-{}.json", nanoid!()));
        let file = std::fs::File::create(&export_path).unwrap();
        let mut writer = JsonStreamWriter::new(file);
        writer.begin_object().unwrap();
        for export in ExportItem::iter() {
            writer.name(&export.to_string())?;
            writer.begin_array().unwrap();
            match export {
                ExportItem::Media => self.export_media(&user_id, &mut writer).await?,
                ExportItem::People => self.export_people(&user_id, &mut writer).await?,
                ExportItem::Workouts => self.export_workouts(&user_id, &mut writer).await?,
                ExportItem::Exercises => self.export_exercises(&user_id, &mut writer).await?,
                ExportItem::MediaGroups => self.export_media_group(&user_id, &mut writer).await?,
                ExportItem::Measurements => self.export_measurements(&user_id, &mut writer).await?,
                ExportItem::WorkoutTemplates => {
                    self.export_workout_templates(&user_id, &mut writer).await?
                }
            };
            writer.end_array().unwrap();
        }
        writer.end_object().unwrap();
        writer.finish_document().unwrap();
        let ended_at = Utc::now();
        let (_key, url) = self
            .0
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
            .body(body)
            .send()
            .await
            .unwrap();
        Ok(())
    }

    async fn export_media(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let mut current_page = 1;
        loop {
            let related_metadata = metadata_list(
                user_id,
                MetadataListInput {
                    search: Some(SearchInput {
                        page: Some(current_page),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                &self.0,
            )
            .await?;
            ryot_log!(debug, "Exporting metadata list page: {current_page}");
            for rm in related_metadata.items.iter() {
                let m = Metadata::find_by_id(rm)
                    .one(&self.0.db)
                    .await?
                    .ok_or_else(|| Error::new("Metadata with the given ID does not exist"))?;
                let seen_history = m
                    .find_related(Seen)
                    .filter(seen::Column::UserId.eq(user_id))
                    .all(&self.0.db)
                    .await
                    .unwrap();
                let seen_history = seen_history
                    .into_iter()
                    .map(|s| {
                        let (show_season_number, show_episode_number) =
                            match s.show_extra_information {
                                Some(d) => (Some(d.season), Some(d.episode)),
                                None => (None, None),
                            };
                        let podcast_episode_number = s.podcast_extra_information.map(|d| d.episode);
                        let anime_episode_number =
                            s.anime_extra_information.and_then(|d| d.episode);
                        let manga_chapter_number =
                            s.manga_extra_information.clone().and_then(|d| d.chapter);
                        let manga_volume_number = s.manga_extra_information.and_then(|d| d.volume);
                        ImportOrExportMetadataItemSeen {
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
                let reviews = item_reviews(user_id, &m.id, EntityLot::Metadata, false, &self.0)
                    .await?
                    .into_iter()
                    .map(|r| self.get_review_export_item(r))
                    .collect();
                let collections =
                    entity_in_collections(&self.0.db, user_id, &m.id, EntityLot::Metadata)
                        .await?
                        .into_iter()
                        .map(|c| c.name)
                        .collect();
                let exp = ImportOrExportMetadataItem {
                    reviews,
                    lot: m.lot,
                    collections,
                    seen_history,
                    source: m.source,
                    source_id: m.title,
                    identifier: m.identifier.clone(),
                };
                writer.serialize_value(&exp).unwrap();
            }
            if let Some(next_page) = related_metadata.details.next_page {
                current_page = next_page;
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn export_media_group(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let related_metadata = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::MetadataGroupId.is_not_null())
            .all(&self.0.db)
            .await
            .unwrap();
        for rm in related_metadata.iter() {
            let m = rm
                .find_related(MetadataGroup)
                .one(&self.0.db)
                .await
                .unwrap()
                .unwrap();
            let reviews = item_reviews(user_id, &m.id, EntityLot::MetadataGroup, false, &self.0)
                .await?
                .into_iter()
                .map(|r| self.get_review_export_item(r))
                .collect();
            let collections =
                entity_in_collections(&self.0.db, user_id, &m.id, EntityLot::MetadataGroup)
                    .await?
                    .into_iter()
                    .map(|c| c.name)
                    .collect();
            let exp = ImportOrExportMetadataGroupItem {
                reviews,
                lot: m.lot,
                collections,
                title: m.title,
                source: m.source,
                identifier: m.identifier.clone(),
            };
            writer.serialize_value(&exp).unwrap();
        }
        Ok(())
    }

    async fn export_people(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let related_people = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::PersonId.is_not_null())
            .all(&self.0.db)
            .await
            .unwrap();
        for rm in related_people.iter() {
            let p = rm
                .find_related(Person)
                .one(&self.0.db)
                .await
                .unwrap()
                .unwrap();
            let reviews = item_reviews(user_id, &p.id, EntityLot::Person, false, &self.0)
                .await?
                .into_iter()
                .map(|r| self.get_review_export_item(r))
                .collect();
            let collections = entity_in_collections(&self.0.db, user_id, &p.id, EntityLot::Person)
                .await?
                .into_iter()
                .map(|c| c.name)
                .collect();
            let exp = ImportOrExportPersonItem {
                reviews,
                collections,
                name: p.name,
                source: p.source,
                identifier: p.identifier,
                source_specifics: p.source_specifics,
            };
            writer.serialize_value(&exp).unwrap();
        }
        Ok(())
    }

    async fn export_workouts(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let workout_ids = Workout::find()
            .select_only()
            .column(workout::Column::Id)
            .filter(workout::Column::UserId.eq(user_id))
            .order_by_desc(workout::Column::EndTime)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for workout_id in workout_ids {
            let details = user_workout_details(user_id, workout_id, &self.0).await?;
            let exp = ImportOrExportWorkoutItem {
                details: details.details,
                collections: details.collections.into_iter().map(|c| c.name).collect(),
            };
            writer.serialize_value(&exp).unwrap();
        }
        Ok(())
    }

    async fn export_measurements(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let measurements =
            user_measurements_list(&self.0.db, user_id, UserMeasurementsListInput::default())
                .await?;
        for measurement in measurements {
            writer.serialize_value(&measurement).unwrap();
        }
        Ok(())
    }

    async fn export_exercises(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let exercises = UserToEntity::find()
            .select_only()
            .column(exercise::Column::Id)
            .column(exercise::Column::Name)
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.is_not_null())
            .left_join(Exercise)
            .into_tuple::<(String, String)>()
            .all(&self.0.db)
            .await
            .unwrap();
        for (exercise_id, exercise_name) in exercises {
            let reviews = item_reviews(user_id, &exercise_id, EntityLot::Exercise, false, &self.0)
                .await?
                .into_iter()
                .map(|r| self.get_review_export_item(r))
                .collect_vec();
            let collections =
                entity_in_collections(&self.0.db, user_id, &exercise_id, EntityLot::Exercise)
                    .await?
                    .into_iter()
                    .map(|c| c.name)
                    .collect_vec();
            if reviews.is_empty() && collections.is_empty() {
                continue;
            }
            let exp = ImportOrExportExerciseItem {
                reviews,
                collections,
                id: exercise_id,
                name: exercise_name,
            };
            writer.serialize_value(&exp).unwrap();
        }
        Ok(())
    }

    async fn export_workout_templates(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let workout_template_ids = WorkoutTemplate::find()
            .select_only()
            .column(workout_template::Column::Id)
            .filter(workout_template::Column::UserId.eq(user_id))
            .order_by_desc(workout_template::Column::CreatedOn)
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for workout_template_id in workout_template_ids {
            let details =
                user_workout_template_details(&self.0.db, user_id, workout_template_id).await?;
            let exp = ImportOrExportWorkoutTemplateItem {
                details: details.details,
                collections: details.collections.into_iter().map(|c| c.name).collect(),
            };
            writer.serialize_value(&exp).unwrap();
        }
        Ok(())
    }

    fn get_review_export_item(&self, rev: ReviewItem) -> ImportOrExportItemRating {
        let (show_season_number, show_episode_number) = match rev.show_extra_information {
            Some(d) => (d.season, d.episode),
            None => (None, None),
        };
        let podcast_episode_number = rev.podcast_extra_information.and_then(|d| d.episode);
        let anime_episode_number = rev.anime_extra_information.and_then(|d| d.episode);
        let manga_chapter_number = rev.manga_extra_information.and_then(|d| d.chapter);
        ImportOrExportItemRating {
            rating: rev.rating,
            show_season_number,
            show_episode_number,
            anime_episode_number,
            manga_chapter_number,
            podcast_episode_number,
            comments: match rev.comments.is_empty() {
                true => None,
                false => Some(rev.comments),
            },
            review: Some(ImportOrExportItemReview {
                visibility: Some(rev.visibility),
                date: Some(rev.posted_on),
                spoiler: Some(rev.is_spoiler),
                text: rev.text_original,
            }),
        }
    }
}
