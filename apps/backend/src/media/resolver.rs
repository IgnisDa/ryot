use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject};
use chrono::{NaiveDate, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait, Order,
    PaginatorTrait, QueryFilter, QueryOrder,
};
use serde::{Deserialize, Serialize};

use crate::{
    audio_books::AudioBookSpecifics,
    books::BookSpecifics,
    entities::{
        creator, genre,
        metadata::{self, Model as MetadataModel},
        metadata_image, metadata_to_creator, metadata_to_genre,
        prelude::{
            AudioBook, Book, Collection, Creator, Genre, Metadata, MetadataImage, Movie, Seen,
            Show, UserToMetadata, VideoGame,
        },
        seen, user_to_metadata,
        utils::{SeenExtraInformation, SeenSeasonExtraInformation},
    },
    graphql::IdObject,
    migrator::{MetadataImageLot, MetadataLot},
    movies::MovieSpecifics,
    shows::ShowSpecifics,
    utils::user_id_from_ctx,
    video_games::VideoGameSpecifics,
};

use super::LIMIT;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaGenericData {
    pub model: MetadataModel,
    pub creators: Vec<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub genres: Vec<String>,
    pub collections: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSearchItem {
    pub identifier: String,
    pub lot: MetadataLot,
    pub title: String,
    pub poster_images: Vec<String>,
    pub publish_year: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
pub struct MediaSearchResults {
    pub total: i32,
    pub items: Vec<MediaSearchItem>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy)]
pub enum ProgressUpdateAction {
    Update,
    Now,
    InThePast,
    JustStarted,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ProgressUpdate {
    pub metadata_id: i32,
    pub progress: Option<i32>,
    pub action: ProgressUpdateAction,
    pub date: Option<NaiveDate>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
    /// If this update comes from a different source, this should be set
    pub identifier: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaDetails<T> {
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub lot: MetadataLot,
    pub creators: Vec<String>,
    pub genres: Vec<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub specifics: T,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct DatabaseMediaDetails {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    #[graphql(name = "type")]
    pub lot: MetadataLot,
    pub creators: Vec<String>,
    pub genres: Vec<String>,
    pub collections: Vec<String>,
    pub poster_images: Vec<String>,
    pub backdrop_images: Vec<String>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
    pub show_specifics: Option<ShowSpecifics>,
    pub video_game_specifics: Option<VideoGameSpecifics>,
    pub audio_book_specifics: Option<AudioBookSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum MediaSortOrder {
    Desc,
    #[default]
    Asc,
}

impl From<MediaSortOrder> for Order {
    fn from(value: MediaSortOrder) -> Self {
        match value {
            MediaSortOrder::Desc => Self::Desc,
            MediaSortOrder::Asc => Self::Asc,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy, Default)]
pub enum MediaSortBy {
    Title,
    #[default]
    ReleaseDate,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaSortInput {
    #[graphql(default)]
    pub order: MediaSortOrder,
    #[graphql(default)]
    pub by: MediaSortBy,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaListInput {
    pub page: i32,
    pub lot: MetadataLot,
    pub sort: Option<MediaSortInput>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaConsumedInput {
    pub identifier: String,
    pub lot: MetadataLot,
}

#[derive(Serialize, Deserialize, Debug, InputObject)]
pub struct SearchInput {
    pub query: String,
    pub page: Option<i32>,
}

#[derive(Default)]
pub struct MediaQuery;

#[Object]
impl MediaQuery {
    /// Get details about a media present in the database
    async fn media_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
    ) -> Result<DatabaseMediaDetails> {
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_details(metadata_id)
            .await
    }

    /// Get the user's seen history for a particular media item
    async fn seen_history(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
    ) -> Result<Vec<seen::Model>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .seen_history(metadata_id, user_id)
            .await
    }

    /// Get all the media items which are in progress for the currently logged in user
    async fn media_in_progress(&self, gql_ctx: &Context<'_>) -> Result<Vec<MediaSearchItem>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_in_progress(user_id)
            .await
    }

    /// Get all the media items for a specific media type
    async fn media_list(
        &self,
        gql_ctx: &Context<'_>,
        input: MediaListInput,
    ) -> Result<MediaSearchResults> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_list(user_id, input)
            .await
    }
}

#[derive(Default)]
pub struct MediaMutation;

#[Object]
impl MediaMutation {
    /// Mark a user's progress on a specific media item
    async fn progress_update(
        &self,
        gql_ctx: &Context<'_>,
        input: ProgressUpdate,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .progress_update(input, user_id)
            .await
    }

    /// Delete a seen item from a user's history
    async fn delete_seen_item(&self, gql_ctx: &Context<'_>, seen_id: i32) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .delete_seen_item(seen_id, user_id)
            .await
    }
}

#[derive(Debug, Clone)]
pub struct MediaService {
    db: DatabaseConnection,
}

impl MediaService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl MediaService {
    async fn metadata_images(&self, meta: &MetadataModel) -> Result<(Vec<String>, Vec<String>)> {
        let images = meta
            .find_related(MetadataImage)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .collect::<Vec<_>>();
        let poster_images = images
            .iter()
            .filter(|f| f.lot == MetadataImageLot::Poster)
            .map(|i| i.url.clone())
            .collect();
        let backdrop_images = images
            .iter()
            .filter(|f| f.lot == MetadataImageLot::Backdrop)
            .map(|i| i.url.clone())
            .collect();
        Ok((poster_images, backdrop_images))
    }

    pub async fn generic_metadata(&self, metadata_id: i32) -> Result<MediaGenericData> {
        let meta = match Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
        {
            Some(m) => m,
            None => return Err(Error::new("The record does not exit".to_owned())),
        };
        let collections = meta
            .find_related(Collection)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        let genres = meta
            .find_related(Genre)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|g| g.name)
            .collect();
        let creators = meta
            .find_related(Creator)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        let (poster_images, backdrop_images) = self.metadata_images(&meta).await.unwrap();
        Ok(MediaGenericData {
            model: meta,
            creators,
            poster_images,
            backdrop_images,
            genres,
            collections,
        })
    }

    async fn media_details(&self, metadata_id: i32) -> Result<DatabaseMediaDetails> {
        let MediaGenericData {
            model,
            creators,
            poster_images,
            backdrop_images,
            genres,
            collections,
        } = self.generic_metadata(metadata_id).await?;
        let mut resp = DatabaseMediaDetails {
            id: model.id,
            title: model.title,
            description: model.description,
            publish_year: model.publish_year,
            publish_date: model.publish_date,
            lot: model.lot,
            creators,
            genres,
            poster_images,
            collections,
            backdrop_images,
            book_specifics: None,
            movie_specifics: None,
            show_specifics: None,
            video_game_specifics: None,
            audio_book_specifics: None,
        };
        match model.lot {
            MetadataLot::Book => {
                let additional = Book::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.book_specifics = Some(BookSpecifics {
                    pages: additional.num_pages,
                    source: additional.source,
                });
            }
            MetadataLot::Movie => {
                let additional = Movie::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.movie_specifics = Some(MovieSpecifics {
                    runtime: additional.runtime,
                    source: additional.source,
                });
            }
            MetadataLot::Show => {
                let additional = Show::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.show_specifics = Some(additional.details);
            }
            MetadataLot::VideoGame => {
                let additional = VideoGame::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.video_game_specifics = Some(VideoGameSpecifics {
                    source: additional.source,
                });
            }
            MetadataLot::AudioBook => {
                let additional = AudioBook::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.audio_book_specifics = Some(AudioBookSpecifics {
                    runtime: additional.runtime,
                    source: additional.source,
                });
            }
        };
        Ok(resp)
    }

    async fn seen_history(&self, metadata_id: i32, user_id: i32) -> Result<Vec<seen::Model>> {
        let mut prev_seen = Seen::find()
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::MetadataId.eq(metadata_id))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .all(&self.db)
            .await
            .unwrap();
        prev_seen.iter_mut().for_each(|s| {
            if let Some(i) = s.extra_information.as_ref() {
                match i {
                    SeenExtraInformation::Show(sea) => {
                        s.show_information = Some(sea.clone());
                    }
                };
            }
        });
        Ok(prev_seen)
    }

    pub async fn media_in_progress(&self, user_id: i32) -> Result<Vec<MediaSearchItem>> {
        let mut seens = Seen::find()
            .filter(seen::Column::Progress.lt(100))
            .filter(seen::Column::UserId.eq(user_id))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .find_also_related(Metadata)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|(_, m)| {
                let a = m.unwrap();
                (
                    a.clone(),
                    MediaSearchItem {
                        identifier: a.id.to_string(),
                        title: a.title,
                        lot: a.lot,
                        poster_images: vec![], // we will assign this later
                        publish_year: a.publish_year,
                    },
                )
            })
            .collect::<Vec<_>>();
        for (model, media_item) in seens.iter_mut() {
            let (poster_images, _) = self.metadata_images(model).await?;
            media_item.poster_images = poster_images;
        }
        Ok(seens.into_iter().map(|s| s.1).collect())
    }

    pub async fn media_list(
        &self,
        user_id: i32,
        input: MediaListInput,
    ) -> Result<MediaSearchResults> {
        let meta = UserToMetadata::find()
            .filter(user_to_metadata::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap();
        let distinct_meta_ids = meta.into_iter().map(|m| m.metadata_id).collect::<Vec<_>>();
        let condition = Metadata::find()
            .filter(metadata::Column::Lot.eq(input.lot))
            .filter(metadata::Column::Id.is_in(distinct_meta_ids));
        let (sort_by, sort_order) = match input.sort {
            None => (metadata::Column::Id, Order::Asc),
            Some(s) => (
                match s.by {
                    MediaSortBy::Title => metadata::Column::Title,
                    MediaSortBy::ReleaseDate => metadata::Column::PublishYear,
                },
                Order::from(s.order),
            ),
        };
        let condition = condition.order_by(sort_by, sort_order);
        let counts = condition.clone().count(&self.db).await.unwrap();
        let paginator = condition.paginate(&self.db, LIMIT as u64);
        let metas = paginator.fetch_page((input.page - 1) as u64).await.unwrap();
        let mut items = vec![];
        for m in metas {
            let (poster_images, _) = self.metadata_images(&m).await?;
            let m_smol = MediaSearchItem {
                identifier: m.id.to_string(),
                lot: m.lot,
                title: m.title,
                poster_images,
                publish_year: m.publish_year,
            };
            items.push(m_smol);
        }
        Ok(MediaSearchResults {
            total: counts as i32,
            items,
        })
    }

    pub async fn progress_update(&self, input: ProgressUpdate, user_id: i32) -> Result<IdObject> {
        let meta = Seen::find()
            .filter(seen::Column::Identifier.eq(input.identifier.clone()))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.metadata_id })
        } else {
            let user_to_meta = user_to_metadata::ActiveModel {
                user_id: ActiveValue::Set(user_id),
                metadata_id: ActiveValue::Set(input.metadata_id),
                ..Default::default()
            };
            // we do not care if it succeeded or failed, since we need just one instance
            user_to_meta.insert(&self.db).await.ok();
            let prev_seen = Seen::find()
                .filter(seen::Column::Progress.lt(100))
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(input.metadata_id))
                .order_by_desc(seen::Column::LastUpdatedOn)
                .all(&self.db)
                .await
                .unwrap();
            let seen_item = match input.action {
                ProgressUpdateAction::Update => {
                    if prev_seen.len() != 1 {
                        return Err(Error::new("There is no `seen` item underway".to_owned()));
                    }
                    let progress = input.progress.unwrap();
                    let mut last_seen: seen::ActiveModel = prev_seen[0].clone().into();
                    last_seen.progress = ActiveValue::Set(progress);
                    last_seen.last_updated_on = ActiveValue::Set(Utc::now());
                    if progress == 100 {
                        last_seen.finished_on = ActiveValue::Set(Some(Utc::now().date_naive()));
                    }
                    last_seen.update(&self.db).await.unwrap()
                }
                ProgressUpdateAction::Now
                | ProgressUpdateAction::InThePast
                | ProgressUpdateAction::JustStarted => {
                    let meta = Metadata::find_by_id(input.metadata_id)
                        .one(&self.db)
                        .await
                        .unwrap()
                        .unwrap();
                    let finished_on = if input.action == ProgressUpdateAction::Now {
                        Some(Utc::now().date_naive())
                    } else {
                        input.date
                    };
                    let (progress, started_on) =
                        if matches!(input.action, ProgressUpdateAction::JustStarted) {
                            (0, Some(Utc::now().date_naive()))
                        } else {
                            (100, None)
                        };
                    let mut seen_ins = seen::ActiveModel {
                        progress: ActiveValue::Set(progress),
                        user_id: ActiveValue::Set(user_id),
                        metadata_id: ActiveValue::Set(input.metadata_id),
                        started_on: ActiveValue::Set(started_on),
                        finished_on: ActiveValue::Set(finished_on),
                        last_updated_on: ActiveValue::Set(Utc::now()),
                        identifier: ActiveValue::Set(input.identifier),
                        ..Default::default()
                    };
                    if meta.lot == MetadataLot::Show {
                        seen_ins.extra_information = ActiveValue::Set(Some(
                            SeenExtraInformation::Show(SeenSeasonExtraInformation {
                                season: input.season_number.unwrap(),
                                episode: input.episode_number.unwrap(),
                            }),
                        ));
                    }
                    seen_ins.insert(&self.db).await.unwrap()
                }
            };
            Ok(IdObject { id: seen_item.id })
        }
    }

    pub async fn delete_seen_item(&self, seen_id: i32, user_id: i32) -> Result<IdObject> {
        let seen_item = Seen::find_by_id(seen_id).one(&self.db).await.unwrap();
        if let Some(si) = seen_item {
            let seen_id = si.id;
            let metadata_id = si.metadata_id;
            if si.user_id != user_id {
                return Err(Error::new(
                    "This seen item does not belong to this user".to_owned(),
                ));
            }
            si.delete(&self.db).await.ok();
            let count = Seen::find()
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(metadata_id))
                .count(&self.db)
                .await
                .unwrap();
            if count == 0 {
                UserToMetadata::delete_many()
                    .filter(user_to_metadata::Column::UserId.eq(user_id))
                    .filter(user_to_metadata::Column::MetadataId.eq(metadata_id))
                    .exec(&self.db)
                    .await
                    .ok();
            }
            Ok(IdObject { id: seen_id })
        } else {
            Err(Error::new("This seen item does not exist".to_owned()))
        }
    }

    pub async fn commit_media(
        &self,
        lot: MetadataLot,
        title: String,
        description: Option<String>,
        publish_year: Option<i32>,
        publish_date: Option<NaiveDate>,
        poster_images: Vec<String>,
        backdrop_images: Vec<String>,
        creator_names: Vec<String>,
        genres: Vec<String>,
    ) -> Result<i32> {
        let metadata = metadata::ActiveModel {
            lot: ActiveValue::Set(lot),
            title: ActiveValue::Set(title),
            description: ActiveValue::Set(description),
            publish_year: ActiveValue::Set(publish_year),
            publish_date: ActiveValue::Set(publish_date),
            ..Default::default()
        };
        let metadata = metadata.insert(&self.db).await.unwrap();
        for image in poster_images.iter() {
            if let Some(c) = MetadataImage::find()
                .filter(metadata_image::Column::Url.eq(image))
                .one(&self.db)
                .await
                .unwrap()
            {
                drop(c);
            } else {
                let c = metadata_image::ActiveModel {
                    url: ActiveValue::Set(image.to_owned()),
                    lot: ActiveValue::Set(MetadataImageLot::Poster),
                    metadata_id: ActiveValue::Set(metadata.id),
                    ..Default::default()
                };
                c.insert(&self.db).await.ok();
            };
        }
        for image in backdrop_images.iter() {
            if let Some(c) = MetadataImage::find()
                .filter(metadata_image::Column::Url.eq(image))
                .one(&self.db)
                .await
                .unwrap()
            {
                drop(c);
            } else {
                let c = metadata_image::ActiveModel {
                    url: ActiveValue::Set(image.to_owned()),
                    lot: ActiveValue::Set(MetadataImageLot::Backdrop),
                    metadata_id: ActiveValue::Set(metadata.id),
                    ..Default::default()
                };
                c.insert(&self.db).await.ok();
            };
        }
        for name in creator_names.iter() {
            let creator = if let Some(c) = Creator::find()
                .filter(creator::Column::Name.eq(name))
                .one(&self.db)
                .await
                .unwrap()
            {
                c
            } else {
                let c = creator::ActiveModel {
                    name: ActiveValue::Set(name.to_owned()),
                    ..Default::default()
                };
                c.insert(&self.db).await.unwrap()
            };
            let metadata_creator = metadata_to_creator::ActiveModel {
                metadata_id: ActiveValue::Set(metadata.id),
                creator_id: ActiveValue::Set(creator.id),
            };
            metadata_creator.insert(&self.db).await.ok();
        }
        for genre in genres {
            let db_genre = if let Some(c) = Genre::find()
                .filter(genre::Column::Name.eq(&genre))
                .one(&self.db)
                .await
                .unwrap()
            {
                c
            } else {
                let c = genre::ActiveModel {
                    name: ActiveValue::Set(genre),
                    ..Default::default()
                };
                c.insert(&self.db).await.unwrap()
            };
            let intermediate = metadata_to_genre::ActiveModel {
                metadata_id: ActiveValue::Set(metadata.id),
                genre_id: ActiveValue::Set(db_genre.id),
            };
            intermediate.insert(&self.db).await.ok();
        }
        Ok(metadata.id)
    }
}
