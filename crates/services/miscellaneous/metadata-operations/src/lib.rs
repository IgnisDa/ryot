use std::sync::Arc;

use anyhow::{Result, bail};
use common_models::{ChangeCollectionToEntitiesInput, DefaultCollection, EntityToCollectionInput};
use common_utils::ryot_log;
use database_models::{
    collection, collection_to_entity,
    functions::get_user_to_entity_association,
    metadata, metadata_to_genre,
    prelude::{
        Collection, CollectionToEntity, Metadata, MetadataToGenre, Review, Seen, UserToEntity,
    },
    review, seen, user_to_entity,
};
use database_utils::entity_in_collections_with_collection_to_entity_ids;
use dependent_collection_utils::add_entities_to_collection;
use dependent_metadata_utils::change_metadata_associations;
use dependent_utility_utils::expire_user_metadata_list_cache;
use enum_models::{EntityLot, MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{CreateCustomMetadataInput, MetadataFreeCreator, UpdateCustomMetadataInput};
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    PaginatorTrait, QueryFilter, QuerySelect, TransactionTrait,
};
use supporting_service::SupportingService;

pub async fn merge_metadata(
    ss: &Arc<SupportingService>,
    user_id: String,
    merge_from: String,
    merge_into: String,
) -> Result<bool> {
    let txn = ss.db.begin().await?;
    for old_seen in Seen::find()
        .filter(seen::Column::MetadataId.eq(&merge_from))
        .filter(seen::Column::UserId.eq(&user_id))
        .all(&txn)
        .await?
    {
        let old_seen_active = old_seen.clone().into_active_model();
        let new_seen = seen::ActiveModel {
            id: ActiveValue::NotSet,
            last_updated_on: ActiveValue::NotSet,
            num_times_updated: ActiveValue::NotSet,
            metadata_id: ActiveValue::Set(merge_into.clone()),
            ..old_seen_active
        };
        new_seen.insert(&txn).await?;
        old_seen.delete(&txn).await?;
    }
    for old_review in Review::find()
        .filter(review::Column::MetadataId.eq(&merge_from))
        .filter(review::Column::UserId.eq(&user_id))
        .all(&txn)
        .await?
    {
        let old_review_active = old_review.clone().into_active_model();
        let new_review = review::ActiveModel {
            id: ActiveValue::NotSet,
            metadata_id: ActiveValue::Set(Some(merge_into.clone())),
            ..old_review_active
        };
        new_review.insert(&txn).await?;
        old_review.delete(&txn).await?;
    }
    let collections = Collection::find()
        .select_only()
        .column(collection::Column::Id)
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(&user_id))
        .into_tuple::<String>()
        .all(&txn)
        .await
        .unwrap();
    for item in CollectionToEntity::find()
        .filter(collection_to_entity::Column::MetadataId.eq(&merge_from))
        .filter(collection_to_entity::Column::CollectionId.is_in(collections))
        .all(&txn)
        .await?
        .into_iter()
    {
        // TODO: https://github.com/SeaQL/sea-orm/discussions/730#discussioncomment-13440496
        if CollectionToEntity::find()
            .filter(collection_to_entity::Column::CollectionId.eq(item.collection_id.clone()))
            .filter(collection_to_entity::Column::MetadataId.eq(&merge_into))
            .count(&txn)
            .await?
            == 0
        {
            let mut item_active = item.into_active_model();
            item_active.metadata_id = ActiveValue::Set(Some(merge_into.clone()));
            item_active.update(&txn).await?;
        }
    }
    if let Some(_association) =
        get_user_to_entity_association(&txn, &user_id, &merge_into, EntityLot::Metadata).await?
    {
        let old_association =
            get_user_to_entity_association(&txn, &user_id, &merge_from, EntityLot::Metadata)
                .await?
                .unwrap();
        let mut cloned = old_association.clone().into_active_model();
        cloned.needs_to_be_updated = ActiveValue::Set(Some(true));
        cloned.update(&txn).await?;
    } else {
        UserToEntity::update_many()
            .filter(user_to_entity::Column::MetadataId.eq(merge_from))
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .set(user_to_entity::ActiveModel {
                metadata_id: ActiveValue::Set(Some(merge_into.clone())),
                ..Default::default()
            })
            .exec(&txn)
            .await?;
    }
    txn.commit().await?;
    expire_user_metadata_list_cache(&user_id, ss).await?;
    Ok(true)
}

pub async fn disassociate_metadata(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_id: String,
) -> Result<bool> {
    let delete_review = Review::delete_many()
        .filter(review::Column::MetadataId.eq(&metadata_id))
        .filter(review::Column::UserId.eq(&user_id))
        .exec(&ss.db)
        .await?;
    ryot_log!(debug, "Deleted {} reviews", delete_review.rows_affected);
    let delete_seen = Seen::delete_many()
        .filter(seen::Column::MetadataId.eq(&metadata_id))
        .filter(seen::Column::UserId.eq(&user_id))
        .exec(&ss.db)
        .await?;
    ryot_log!(debug, "Deleted {} seen items", delete_seen.rows_affected);
    let collections_part_of = entity_in_collections_with_collection_to_entity_ids(
        &ss.db,
        &user_id,
        &metadata_id,
        EntityLot::Metadata,
    )
    .await?
    .into_iter()
    .map(|(_, id)| id);
    let delete_collections = CollectionToEntity::delete_many()
        .filter(collection_to_entity::Column::Id.is_in(collections_part_of))
        .exec(&ss.db)
        .await?;
    ryot_log!(
        debug,
        "Deleted {} collections",
        delete_collections.rows_affected
    );
    UserToEntity::delete_many()
        .filter(user_to_entity::Column::MetadataId.eq(metadata_id.clone()))
        .filter(user_to_entity::Column::UserId.eq(user_id.clone()))
        .exec(&ss.db)
        .await?;
    expire_user_metadata_list_cache(&user_id, ss).await?;
    Ok(true)
}

pub async fn create_custom_metadata(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: CreateCustomMetadataInput,
) -> Result<metadata::Model> {
    let identifier = nanoid!(10);
    let metadata = get_data_for_custom_metadata(input.clone(), identifier, &user_id);
    let metadata = metadata.insert(&ss.db).await?;
    change_metadata_associations(
        &metadata.id,
        input.genres.unwrap_or_default(),
        vec![],
        vec![],
        vec![],
        ss,
    )
    .await?;
    add_entities_to_collection(
        &user_id,
        ChangeCollectionToEntitiesInput {
            creator_user_id: user_id.to_owned(),
            collection_name: DefaultCollection::Custom.to_string(),
            entities: vec![EntityToCollectionInput {
                information: None,
                entity_id: metadata.id.clone(),
                entity_lot: EntityLot::Metadata,
            }],
        },
        ss,
    )
    .await?;
    expire_user_metadata_list_cache(&user_id, ss).await?;
    Ok(metadata)
}

pub async fn update_custom_metadata(
    ss: &Arc<SupportingService>,
    user_id: &str,
    input: UpdateCustomMetadataInput,
) -> Result<bool> {
    let metadata = Metadata::find_by_id(&input.existing_metadata_id)
        .one(&ss.db)
        .await?
        .unwrap();
    if metadata.source != MediaSource::Custom {
        bail!("This metadata is not custom and cannot be updated",);
    }
    if metadata.created_by_user_id != Some(user_id.to_owned()) {
        bail!("You are not authorized to update this metadata");
    }
    MetadataToGenre::delete_many()
        .filter(metadata_to_genre::Column::MetadataId.eq(&input.existing_metadata_id))
        .exec(&ss.db)
        .await?;
    for image in metadata.assets.s3_images.clone() {
        file_storage_service::delete_object(ss, image).await?;
    }
    for video in metadata.assets.s3_videos.clone() {
        file_storage_service::delete_object(ss, video).await?;
    }
    let mut new_metadata =
        get_data_for_custom_metadata(input.update.clone(), metadata.identifier, user_id);
    new_metadata.id = ActiveValue::Unchanged(input.existing_metadata_id);
    let metadata = new_metadata.update(&ss.db).await?;
    change_metadata_associations(
        &metadata.id,
        input.update.genres.unwrap_or_default(),
        vec![],
        vec![],
        vec![],
        ss,
    )
    .await?;
    expire_user_metadata_list_cache(&user_id.to_string(), ss).await?;
    Ok(true)
}

fn get_data_for_custom_metadata(
    input: CreateCustomMetadataInput,
    identifier: String,
    user_id: &str,
) -> metadata::ActiveModel {
    let free_creators = input
        .creators
        .unwrap_or_default()
        .into_iter()
        .map(|c| MetadataFreeCreator {
            name: c,
            role: "Creator".to_string(),
            ..Default::default()
        })
        .collect_vec();
    let is_partial = match input.lot {
        MediaLot::Show => input.show_specifics.is_none(),
        MediaLot::Book => input.book_specifics.is_none(),
        MediaLot::Music => input.music_specifics.is_none(),
        MediaLot::Anime => input.anime_specifics.is_none(),
        MediaLot::Manga => input.manga_specifics.is_none(),
        MediaLot::Movie => input.movie_specifics.is_none(),
        MediaLot::Podcast => input.podcast_specifics.is_none(),
        MediaLot::AudioBook => input.audio_book_specifics.is_none(),
        MediaLot::VideoGame => input.video_game_specifics.is_none(),
        MediaLot::VisualNovel => input.visual_novel_specifics.is_none(),
    };
    metadata::ActiveModel {
        lot: ActiveValue::Set(input.lot),
        title: ActiveValue::Set(input.title),
        assets: ActiveValue::Set(input.assets),
        identifier: ActiveValue::Set(identifier),
        is_nsfw: ActiveValue::Set(input.is_nsfw),
        source: ActiveValue::Set(MediaSource::Custom),
        is_partial: ActiveValue::Set(Some(is_partial)),
        description: ActiveValue::Set(input.description),
        publish_year: ActiveValue::Set(input.publish_year),
        show_specifics: ActiveValue::Set(input.show_specifics),
        book_specifics: ActiveValue::Set(input.book_specifics),
        manga_specifics: ActiveValue::Set(input.manga_specifics),
        anime_specifics: ActiveValue::Set(input.anime_specifics),
        movie_specifics: ActiveValue::Set(input.movie_specifics),
        music_specifics: ActiveValue::Set(input.music_specifics),
        podcast_specifics: ActiveValue::Set(input.podcast_specifics),
        created_by_user_id: ActiveValue::Set(Some(user_id.to_owned())),
        audio_book_specifics: ActiveValue::Set(input.audio_book_specifics),
        video_game_specifics: ActiveValue::Set(input.video_game_specifics),
        visual_novel_specifics: ActiveValue::Set(input.visual_novel_specifics),
        free_creators: ActiveValue::Set(match free_creators.is_empty() {
            true => None,
            false => Some(free_creators),
        }),
        ..Default::default()
    }
}
