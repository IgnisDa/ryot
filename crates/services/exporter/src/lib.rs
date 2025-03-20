use std::{collections::HashMap, fs::File as StdFile, path::PathBuf, sync::Arc};

use async_graphql::{Error, Result};
use background_models::{ApplicationJob, MpApplicationJob};
use chrono::{DateTime, Utc};
use common_models::{ExportJob, SearchInput};
use common_utils::{TEMPORARY_DIRECTORY, ryot_log};
use database_models::{
    prelude::{Exercise, Metadata, MetadataGroup, Person, Seen},
    seen,
};
use database_utils::{
    entity_in_collections, item_reviews, user_measurements_list, user_workout_details,
    user_workout_template_details,
};
use dependent_models::{
    ImportOrExportWorkoutItem, ImportOrExportWorkoutTemplateItem, UserMetadataGroupsListInput,
    UserMetadataListInput, UserPeopleListInput, UserTemplatesOrWorkoutsListInput,
};
use dependent_utils::{
    user_exercises_list, user_metadata_groups_list, user_metadata_list, user_people_list,
    user_workout_templates_list, user_workouts_list,
};
use enum_models::EntityLot;
use fitness_models::{UserExercisesListInput, UserMeasurementsListInput};
use itertools::Itertools;
use media_models::{
    ImportOrExportExerciseItem, ImportOrExportItemRating, ImportOrExportItemReview,
    ImportOrExportMetadataGroupItem, ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen,
    ImportOrExportPersonItem, ReviewItem,
};
use nanoid::nanoid;
use reqwest::{
    Body, Client,
    header::{CONTENT_LENGTH, CONTENT_TYPE},
};
use sea_orm::{
    ColumnTrait, EntityTrait, EnumIter, Iterable, ModelTrait, QueryFilter, strum::Display,
};
use struson::writer::{JsonStreamWriter, JsonWriter};
use supporting_service::SupportingService;
use tokio::fs::File;
use tokio_util::codec::{BytesCodec, FramedRead};

#[derive(Eq, PartialEq, Copy, Display, Clone, Debug, EnumIter)]
#[strum(serialize_all = "snake_case")]
enum ExportItem {
    People,
    Workouts,
    Metadata,
    Exercises,
    Measurements,
    MetadataGroups,
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
        for (size, key) in objects {
            let url = self
                .0
                .file_storage_service
                .get_presigned_url(key.clone())
                .await;
            let metadata = self
                .0
                .file_storage_service
                .get_object_metadata(key.clone())
                .await;
            let started_at = DateTime::parse_from_rfc2822(metadata.get("started_at").unwrap())
                .unwrap()
                .with_timezone(&Utc);
            let ended_at = DateTime::parse_from_rfc2822(metadata.get("ended_at").unwrap())
                .unwrap()
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
        if !self.0.config.file_storage.is_enabled() {
            return Err(Error::new(
                "File storage needs to be enabled to perform an export.",
            ));
        }
        let started_at = Utc::now();
        let export_path =
            PathBuf::from(TEMPORARY_DIRECTORY).join(format!("ryot-export-{}.json", nanoid!()));
        let file = std::fs::File::create(&export_path).unwrap();
        let mut writer = JsonStreamWriter::new(file);
        writer.begin_object().unwrap();
        for export in ExportItem::iter() {
            ryot_log!(debug, "Exporting {export}");
            writer.name(&export.to_string())?;
            writer.begin_array().unwrap();
            match export {
                ExportItem::Metadata => self.export_media(&user_id, &mut writer).await?,
                ExportItem::People => self.export_people(&user_id, &mut writer).await?,
                ExportItem::Workouts => self.export_workouts(&user_id, &mut writer).await?,
                ExportItem::Exercises => self.export_exercises(&user_id, &mut writer).await?,
                ExportItem::MetadataGroups => {
                    self.export_media_group(&user_id, &mut writer).await?
                }
                ExportItem::Measurements => self.export_measurements(&user_id, &mut writer).await?,
                ExportItem::WorkoutTemplates => {
                    self.export_workout_templates(&user_id, &mut writer).await?
                }
            };
            writer.end_array().unwrap();
        }
        writer.end_object().unwrap();
        writer.finish_document().unwrap();
        ryot_log!(debug, "Exporting completed");
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
            let related_metadata = user_metadata_list(
                user_id,
                UserMetadataListInput {
                    search: Some(SearchInput {
                        take: Some(1000),
                        page: Some(current_page),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                &self.0,
            )
            .await?;
            ryot_log!(debug, "Exporting metadata list page: {current_page}");
            for rm in related_metadata.response.items.iter() {
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
            if let Some(next_page) = related_metadata.response.details.next_page {
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
        let mut current_page = 1;
        loop {
            let related_metadata = user_metadata_groups_list(
                user_id,
                &self.0,
                UserMetadataGroupsListInput {
                    search: Some(SearchInput {
                        take: Some(1000),
                        page: Some(current_page),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .await?;
            ryot_log!(debug, "Exporting metadata groups list page: {current_page}");
            for rm in related_metadata.response.items.iter() {
                let m = MetadataGroup::find_by_id(rm)
                    .one(&self.0.db)
                    .await?
                    .ok_or_else(|| Error::new("Metadata group with the given ID does not exist"))?;
                let reviews =
                    item_reviews(user_id, &m.id, EntityLot::MetadataGroup, false, &self.0)
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
            if let Some(next_page) = related_metadata.response.details.next_page {
                current_page = next_page;
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn export_people(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let mut current_page = 1;
        loop {
            let related_people = user_people_list(
                user_id,
                UserPeopleListInput {
                    search: Some(SearchInput {
                        take: Some(1000),
                        page: Some(current_page),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                &self.0,
            )
            .await?;
            ryot_log!(debug, "Exporting people list page: {current_page}");
            for rm in related_people.response.items.iter() {
                let p = Person::find_by_id(rm)
                    .one(&self.0.db)
                    .await?
                    .ok_or_else(|| Error::new("Person with the given ID does not exist"))?;
                let reviews = item_reviews(user_id, &p.id, EntityLot::Person, false, &self.0)
                    .await?
                    .into_iter()
                    .map(|r| self.get_review_export_item(r))
                    .collect();
                let collections =
                    entity_in_collections(&self.0.db, user_id, &p.id, EntityLot::Person)
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
            if let Some(next_page) = related_people.response.details.next_page {
                current_page = next_page;
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn export_workouts(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let mut current_page = 1;
        loop {
            let workout_ids = user_workouts_list(
                user_id,
                UserTemplatesOrWorkoutsListInput {
                    search: SearchInput {
                        take: Some(1000),
                        page: Some(current_page),
                        ..Default::default()
                    },
                    ..Default::default()
                },
                &self.0,
            )
            .await?;
            ryot_log!(debug, "Exporting workouts list page: {current_page}");
            for workout_id in workout_ids.response.items {
                let details = user_workout_details(user_id, workout_id, &self.0).await?;
                let exp = ImportOrExportWorkoutItem {
                    details: details.details,
                    collections: details.collections.into_iter().map(|c| c.name).collect(),
                };
                writer.serialize_value(&exp).unwrap();
            }
            if let Some(next_page) = workout_ids.response.details.next_page {
                current_page = next_page;
            } else {
                break;
            }
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
        let mut current_page = 1;
        loop {
            let exercises = user_exercises_list(
                user_id,
                UserExercisesListInput {
                    search: SearchInput {
                        take: Some(1000),
                        page: Some(current_page),
                        ..Default::default()
                    },
                    ..Default::default()
                },
                &self.0,
            )
            .await?;
            for exercise_id in exercises.response.items {
                let reviews =
                    item_reviews(user_id, &exercise_id, EntityLot::Exercise, false, &self.0)
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
                let exercise = Exercise::find_by_id(exercise_id.clone())
                    .one(&self.0.db)
                    .await?
                    .ok_or_else(|| Error::new("Exercise with the given ID does not exist"))?;
                let exp = ImportOrExportExerciseItem {
                    reviews,
                    collections,
                    id: exercise_id,
                    name: exercise.name,
                };
                writer.serialize_value(&exp).unwrap();
            }
            if let Some(next_page) = exercises.response.details.next_page {
                current_page = next_page;
            } else {
                break;
            }
        }
        Ok(())
    }

    async fn export_workout_templates(
        &self,
        user_id: &String,
        writer: &mut JsonStreamWriter<StdFile>,
    ) -> Result<()> {
        let mut current_page = 1;
        loop {
            let workout_template_ids = user_workout_templates_list(
                user_id,
                &self.0,
                UserTemplatesOrWorkoutsListInput {
                    search: SearchInput {
                        take: Some(1000),
                        page: Some(current_page),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            )
            .await?;
            ryot_log!(
                debug,
                "Exporting workout templates list page: {current_page}"
            );
            for workout_template_id in workout_template_ids.response.items {
                let details =
                    user_workout_template_details(&self.0.db, user_id, workout_template_id).await?;
                let exp = ImportOrExportWorkoutTemplateItem {
                    details: details.details,
                    collections: details.collections.into_iter().map(|c| c.name).collect(),
                };
                writer.serialize_value(&exp).unwrap();
            }
            if let Some(next_page) = workout_template_ids.response.details.next_page {
                current_page = next_page;
            } else {
                break;
            }
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
                text: rev.text_original,
                date: Some(rev.posted_on),
                spoiler: Some(rev.is_spoiler),
                visibility: Some(rev.visibility),
            }),
        }
    }
}
