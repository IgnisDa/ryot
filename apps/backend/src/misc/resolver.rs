use std::sync::Arc;

use async_graphql::{Context, Error, InputObject, Object, Result, SimpleObject};
use chrono::Utc;
use rust_decimal::Decimal;
use sea_orm::{
    prelude::DateTimeUtc, ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection,
    EntityTrait, QueryFilter, QueryOrder,
};

use crate::{
    entities::{
        collection, media_import_report, metadata_to_collection,
        prelude::{Collection, MediaImportReport, Metadata, Review, User},
        review,
        utils::{SeenExtraInformation, SeenShowExtraInformation},
    },
    graphql::{IdObject, Identifier},
    importer::ImportResultResponse,
    media::resolver::{MediaSearchItem, MediaService},
    migrator::{MediaImportSource, ReviewVisibility},
    utils::{user_id_from_ctx, NamedObject},
};

#[derive(Debug, SimpleObject)]
struct ReviewPostedBy {
    id: Identifier,
    name: String,
}

#[derive(Debug, SimpleObject)]
struct ReviewItem {
    id: Identifier,
    posted_on: DateTimeUtc,
    rating: Option<Decimal>,
    text: Option<String>,
    visibility: ReviewVisibility,
    spoiler: bool,
    season_number: Option<i32>,
    episode_number: Option<i32>,
    posted_by: ReviewPostedBy,
    podcast_episode_id: Option<i32>,
}

#[derive(Debug, InputObject)]
pub struct PostReviewInput {
    pub rating: Option<Decimal>,
    pub text: Option<String>,
    pub visibility: Option<ReviewVisibility>,
    pub spoiler: Option<bool>,
    pub metadata_id: Identifier,
    pub date: Option<DateTimeUtc>,
    /// If this review comes from a different source, this should be set
    pub identifier: Option<String>,
    /// ID of the review if this is an update to an existing review
    pub review_id: Option<Identifier>,
    pub season_number: Option<i32>,
    pub episode_number: Option<i32>,
}

#[derive(Debug, SimpleObject)]
struct CollectionItem {
    collection_details: collection::Model,
    media_details: Vec<MediaSearchItem>,
}

#[derive(Debug, InputObject)]
pub struct AddMediaToCollection {
    pub collection_name: String,
    pub media_id: Identifier,
}

#[derive(Default)]
pub struct MiscQuery;

#[Object]
impl MiscQuery {
    /// Get all the public reviews for a media item.
    async fn media_item_reviews(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
    ) -> Result<Vec<ReviewItem>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .media_item_reviews(&user_id, &metadata_id.into())
            .await
    }

    /// Get all collections for the currently logged in user.
    async fn collections(&self, gql_ctx: &Context<'_>) -> Result<Vec<CollectionItem>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .collections(&user_id)
            .await
    }
}

#[derive(Default)]
pub struct MiscMutation;

#[Object]
impl MiscMutation {
    /// Create or update a review.
    async fn post_review(&self, gql_ctx: &Context<'_>, input: PostReviewInput) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .post_review(&user_id, input)
            .await
    }

    /// Create a new collection for the logged in user.
    async fn create_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: NamedObject,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .create_collection(&user_id, input)
            .await
    }

    /// Add a media item to a collection if it is not there, otherwise do nothing.
    async fn add_media_to_collection(
        &self,
        gql_ctx: &Context<'_>,
        input: AddMediaToCollection,
    ) -> Result<bool> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .add_media_to_collection(&user_id, input)
            .await
    }

    /// Remove a media item from a collection if it is not there, otherwise do nothing.
    async fn remove_media_from_collection(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: Identifier,
        collection_name: String,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MiscService>()
            .remove_media_item_from_collection(&user_id, &metadata_id.into(), &collection_name)
            .await
    }
}

#[derive(Debug, Clone)]
pub struct MiscService {
    db: DatabaseConnection,
    media_service: Arc<MediaService>,
}

impl MiscService {
    pub fn new(db: &DatabaseConnection, media_service: &MediaService) -> Self {
        Self {
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl MiscService {
    async fn media_item_reviews(
        &self,
        user_id: &i32,
        metadata_id: &i32,
    ) -> Result<Vec<ReviewItem>> {
        let all_reviews = Review::find()
            .order_by_desc(review::Column::PostedOn)
            .filter(review::Column::MetadataId.eq(metadata_id.to_owned()))
            .find_also_related(User)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|(r, u)| {
                let (show_se, show_ep, podcast_ep) = match r.extra_information {
                    Some(s) => match s {
                        SeenExtraInformation::Show(d) => (Some(d.season), Some(d.episode), None),
                        SeenExtraInformation::Podcast(d) => (None, None, Some(d.episode)),
                    },
                    None => (None, None, None),
                };
                let user = u.unwrap();
                ReviewItem {
                    id: r.id.into(),
                    posted_on: r.posted_on,
                    rating: r.rating,
                    spoiler: r.spoiler,
                    text: r.text,
                    visibility: r.visibility,
                    season_number: show_se,
                    episode_number: show_ep,
                    podcast_episode_id: podcast_ep,
                    posted_by: ReviewPostedBy {
                        id: user.id.into(),
                        name: user.name,
                    },
                }
            })
            .collect::<Vec<_>>();
        let all_reviews = all_reviews
            .into_iter()
            .filter(|r| match r.visibility {
                ReviewVisibility::Private => i32::from(r.posted_by.id) == *user_id,
                _ => true,
            })
            .collect();
        Ok(all_reviews)
    }

    async fn collections(&self, user_id: &i32) -> Result<Vec<CollectionItem>> {
        let collections = Collection::find()
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .find_with_related(Metadata)
            .all(&self.db)
            .await
            .unwrap();
        let mut data = vec![];
        for (col, metas) in collections.into_iter() {
            let mut meta_data = vec![];
            for meta in metas {
                let m = self.media_service.generic_metadata(meta.id).await?;
                meta_data.push(MediaSearchItem {
                    identifier: m.model.id.to_string(),
                    lot: m.model.lot,
                    title: m.model.title,
                    poster_images: m.poster_images,
                    publish_year: m.model.publish_year,
                })
            }
            data.push(CollectionItem {
                collection_details: col,
                media_details: meta_data,
            });
        }
        Ok(data)
    }

    pub async fn post_review(&self, user_id: &i32, input: PostReviewInput) -> Result<IdObject> {
        let meta = Review::find()
            .filter(review::Column::Identifier.eq(input.identifier.clone()))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject {
                id: m.metadata_id.into(),
            })
        } else {
            let review_id = match input.review_id {
                Some(i) => ActiveValue::Set(i32::from(i)),
                None => ActiveValue::NotSet,
            };
            let mut review_obj = review::ActiveModel {
                id: review_id,
                rating: ActiveValue::Set(input.rating),
                text: ActiveValue::Set(input.text),
                user_id: ActiveValue::Set(user_id.to_owned()),
                metadata_id: ActiveValue::Set(i32::from(input.metadata_id)),
                extra_information: ActiveValue::NotSet,
                identifier: ActiveValue::Set(input.identifier),
                ..Default::default()
            };
            if let Some(s) = input.spoiler {
                review_obj.spoiler = ActiveValue::Set(s);
            }
            if let Some(v) = input.visibility {
                review_obj.visibility = ActiveValue::Set(v);
            }
            if let Some(d) = input.date {
                review_obj.posted_on = ActiveValue::Set(d);
            }
            if let (Some(s), Some(e)) = (input.season_number, input.episode_number) {
                review_obj.extra_information =
                    ActiveValue::Set(Some(SeenExtraInformation::Show(SeenShowExtraInformation {
                        season: s,
                        episode: e,
                    })));
            }
            let insert = review_obj.save(&self.db).await.unwrap();
            Ok(IdObject {
                id: insert.id.unwrap().into(),
            })
        }
    }

    pub async fn create_collection(&self, user_id: &i32, input: NamedObject) -> Result<IdObject> {
        let meta = Collection::find()
            .filter(collection::Column::Name.eq(input.name.clone()))
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.id.into() })
        } else {
            let col = collection::ActiveModel {
                name: ActiveValue::Set(input.name),
                user_id: ActiveValue::Set(user_id.to_owned()),
                ..Default::default()
            };
            let inserted = col
                .insert(&self.db)
                .await
                .map_err(|_| Error::new("There was an error creating the collection".to_owned()))?;
            Ok(IdObject {
                id: inserted.id.into(),
            })
        }
    }

    pub async fn remove_media_item_from_collection(
        &self,
        user_id: &i32,
        metadata_id: &i32,
        collection_name: &str,
    ) -> Result<IdObject> {
        let collect = Collection::find()
            .filter(collection::Column::Name.eq(collection_name.clone()))
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let col = metadata_to_collection::ActiveModel {
            metadata_id: ActiveValue::Set(metadata_id.to_owned()),
            collection_id: ActiveValue::Set(collect.id),
        };
        let id = col.collection_id.clone().unwrap();
        col.delete(&self.db).await.ok();
        Ok(IdObject { id: id.into() })
    }

    pub async fn add_media_to_collection(
        &self,
        user_id: &i32,
        input: AddMediaToCollection,
    ) -> Result<bool> {
        let collection = Collection::find()
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .filter(collection::Column::Name.eq(input.collection_name))
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let col = metadata_to_collection::ActiveModel {
            metadata_id: ActiveValue::Set(i32::from(input.media_id)),
            collection_id: ActiveValue::Set(i32::from(collection.id)),
        };
        Ok(match col.clone().insert(&self.db).await {
            Ok(_) => true,
            Err(_) => false,
        })
    }

    pub async fn start_import_job(
        &self,
        user_id: i32,
        source: MediaImportSource,
    ) -> Result<media_import_report::Model> {
        let model = media_import_report::ActiveModel {
            user_id: ActiveValue::Set(user_id),
            source: ActiveValue::Set(source),
            ..Default::default()
        };
        let model = model.insert(&self.db).await.unwrap();
        tracing::info!("Started import job with id = {id}", id = model.id);
        Ok(model)
    }

    pub async fn finish_import_job(
        &self,
        job: media_import_report::Model,
        details: ImportResultResponse,
    ) -> Result<media_import_report::Model> {
        let mut model: media_import_report::ActiveModel = job.into();
        model.finished_on = ActiveValue::Set(Some(Utc::now()));
        model.details = ActiveValue::Set(Some(details));
        model.success = ActiveValue::Set(Some(true));
        let model = model.update(&self.db).await.unwrap();
        Ok(model)
    }

    pub async fn media_import_reports(
        &self,
        user_id: i32,
    ) -> Result<Vec<media_import_report::Model>> {
        let reports = MediaImportReport::find()
            .filter(media_import_report::Column::UserId.eq(user_id))
            .all(&self.db)
            .await
            .unwrap();
        Ok(reports)
    }
}
