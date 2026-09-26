use std::sync::Arc;

use anyhow::{Result, bail};
use chrono::Datelike;
use common_models::{
    ChangeCollectionToEntitiesInput, DefaultCollection, EntityAssets, EntityToCollectionInput,
};
use common_utils::ryot_log;
use database_models::{
    collection, collection_entity_membership, collection_to_entity,
    functions::get_user_to_entity_association,
    metadata, metadata_group, metadata_to_genre, person,
    prelude::{
        Collection, CollectionEntityMembership, CollectionToEntity, Metadata, MetadataGroup,
        MetadataToGenre, Person, Review, Seen, UserToEntity,
    },
    review, seen, user_to_entity,
};
use database_utils::entity_in_collections_with_collection_to_entity_ids;
use dependent_collection_utils::{add_entities_to_collection, remove_entities_from_collection};
use dependent_details_utils::metadata_details;
use dependent_entity_utils::{
    change_metadata_associations, insert_metadata_group_links, insert_metadata_person_links,
};
use dependent_notification_utils::send_notification_for_user;
use dependent_seen_utils::is_metadata_finished_by_user;
use dependent_utility_utils::{
    expire_metadata_details_cache, expire_metadata_group_details_cache,
    expire_person_details_cache, expire_user_metadata_groups_list_cache,
    expire_user_metadata_list_cache, expire_user_people_list_cache,
};
use enum_models::{EntityLot, MediaLot, MediaSource, UserNotificationContent};
use futures::try_join;
use media_models::{
    CreateCustomMetadataGroupInput, CreateCustomMetadataInput, UpdateCustomMetadataGroupInput,
    UpdateCustomMetadataInput, UpdateCustomPersonInput,
};
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    PaginatorTrait, QueryFilter, QuerySelect, TransactionTrait, prelude::Expr,
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
            .filter(collection_to_entity::Column::MetadataId.eq(&merge_into))
            .filter(collection_to_entity::Column::CollectionId.eq(item.collection_id.clone()))
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
        &user_id,
        &metadata_id,
        EntityLot::Metadata,
        ss,
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
    if let Some(groups) = input.group_ids.clone() {
        let links = groups
            .into_iter()
            .enumerate()
            .map(|(idx, group_id)| (group_id, Some(idx as i32)))
            .collect();
        insert_metadata_group_links(ss, &metadata.id, links).await?;
    }
    if let Some(creators) = input.creator_ids.clone() {
        let links = creators
            .into_iter()
            .enumerate()
            .map(|(idx, person_id)| (person_id, "Creator".to_string(), None, Some(idx as i32)))
            .collect();
        insert_metadata_person_links(ss, &metadata.id, links).await?;
    }
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
    user_id: &String,
    input: UpdateCustomMetadataInput,
) -> Result<bool> {
    let UpdateCustomMetadataInput {
        update,
        existing_metadata_id,
    } = input;
    let metadata = Metadata::find_by_id(&existing_metadata_id)
        .one(&ss.db)
        .await?
        .unwrap();
    ensure_user_can_update_custom_entity(
        "metadata",
        metadata.source,
        metadata.created_by_user_id.clone(),
        user_id,
    )?;
    delete_removed_s3_assets(ss, &metadata.assets, &update.assets).await?;
    MetadataToGenre::delete_many()
        .filter(metadata_to_genre::Column::MetadataId.eq(&existing_metadata_id))
        .exec(&ss.db)
        .await?;
    let mut new_metadata =
        get_data_for_custom_metadata(update.clone(), metadata.identifier, user_id);
    new_metadata.id = ActiveValue::Unchanged(existing_metadata_id.clone());
    let metadata = new_metadata.update(&ss.db).await?;
    change_metadata_associations(
        &metadata.id,
        update.genres.clone().unwrap_or_default(),
        vec![],
        vec![],
        vec![],
        ss,
    )
    .await?;
    if let Some(groups) = update.group_ids.clone() {
        let links = groups
            .into_iter()
            .enumerate()
            .map(|(idx, group_id)| (group_id, Some(idx as i32)))
            .collect();
        insert_metadata_group_links(ss, &metadata.id, links).await?;
    }
    if let Some(creators) = update.creator_ids.clone() {
        let links = creators
            .into_iter()
            .enumerate()
            .map(|(idx, person_id)| (person_id, "Creator".to_string(), None, Some(idx as i32)))
            .collect();
        insert_metadata_person_links(ss, &metadata.id, links).await?;
    }
    try_join!(
        expire_user_metadata_list_cache(user_id, ss),
        expire_metadata_details_cache(&metadata.id, ss)
    )?;
    Ok(true)
}

pub async fn create_custom_metadata_group(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: CreateCustomMetadataGroupInput,
) -> Result<metadata_group::Model> {
    let identifier = nanoid!(10);
    let new_group = metadata_group::ActiveModel {
        parts: ActiveValue::Set(1),
        lot: ActiveValue::Set(input.lot),
        title: ActiveValue::Set(input.title),
        assets: ActiveValue::Set(input.assets),
        identifier: ActiveValue::Set(identifier),
        is_partial: ActiveValue::Set(Some(false)),
        source: ActiveValue::Set(MediaSource::Custom),
        description: ActiveValue::Set(input.description),
        created_by_user_id: ActiveValue::Set(Some(user_id.clone())),
        ..Default::default()
    };
    let group = new_group.insert(&ss.db).await?;

    add_entities_to_collection(
        user_id,
        ChangeCollectionToEntitiesInput {
            creator_user_id: user_id.to_owned(),
            collection_name: DefaultCollection::Custom.to_string(),
            entities: vec![EntityToCollectionInput {
                information: None,
                entity_id: group.id.clone(),
                entity_lot: EntityLot::MetadataGroup,
            }],
        },
        ss,
    )
    .await?;

    expire_user_metadata_groups_list_cache(user_id, ss).await?;

    Ok(group)
}

pub async fn create_custom_person(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: media_models::CreateCustomPersonInput,
) -> Result<person::Model> {
    let identifier = nanoid!(10);
    let new_person = person::ActiveModel {
        name: ActiveValue::Set(input.name),
        place: ActiveValue::Set(input.place),
        assets: ActiveValue::Set(input.assets),
        gender: ActiveValue::Set(input.gender),
        website: ActiveValue::Set(input.website),
        identifier: ActiveValue::Set(identifier),
        is_partial: ActiveValue::Set(Some(false)),
        source: ActiveValue::Set(MediaSource::Custom),
        birth_date: ActiveValue::Set(input.birth_date),
        death_date: ActiveValue::Set(input.death_date),
        description: ActiveValue::Set(input.description),
        alternate_names: ActiveValue::Set(input.alternate_names),
        created_by_user_id: ActiveValue::Set(Some(user_id.clone())),
        ..Default::default()
    };
    let person = new_person.insert(&ss.db).await?;

    add_entities_to_collection(
        &user_id,
        ChangeCollectionToEntitiesInput {
            creator_user_id: user_id.to_owned(),
            collection_name: DefaultCollection::Custom.to_string(),
            entities: vec![EntityToCollectionInput {
                information: None,
                entity_id: person.id.clone(),
                entity_lot: EntityLot::Person,
            }],
        },
        ss,
    )
    .await?;

    expire_user_people_list_cache(&user_id, ss).await?;

    Ok(person)
}

pub async fn update_custom_metadata_group(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: UpdateCustomMetadataGroupInput,
) -> Result<bool> {
    let UpdateCustomMetadataGroupInput {
        update,
        existing_metadata_group_id,
    } = input;
    let group = MetadataGroup::find_by_id(&existing_metadata_group_id)
        .one(&ss.db)
        .await?
        .unwrap();
    ensure_user_can_update_custom_entity(
        "metadata group",
        group.source,
        group.created_by_user_id.clone(),
        user_id,
    )?;
    delete_removed_s3_assets(ss, &group.assets, &update.assets).await?;
    let new_group = metadata_group::ActiveModel {
        parts: ActiveValue::Set(1),
        lot: ActiveValue::Set(update.lot),
        is_partial: ActiveValue::Set(Some(false)),
        title: ActiveValue::Set(update.title),
        assets: ActiveValue::Set(update.assets),
        description: ActiveValue::Set(update.description),
        id: ActiveValue::Unchanged(existing_metadata_group_id),
        ..Default::default()
    };
    new_group.update(&ss.db).await?;
    try_join!(
        expire_user_metadata_groups_list_cache(user_id, ss),
        expire_metadata_group_details_cache(&group.id, ss)
    )?;
    Ok(true)
}

pub async fn update_custom_person(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: UpdateCustomPersonInput,
) -> Result<bool> {
    let UpdateCustomPersonInput {
        update,
        existing_person_id,
    } = input;
    let person_model = Person::find_by_id(&existing_person_id)
        .one(&ss.db)
        .await?
        .unwrap();
    ensure_user_can_update_custom_entity(
        "person",
        person_model.source,
        person_model.created_by_user_id.clone(),
        user_id,
    )?;
    delete_removed_s3_assets(ss, &person_model.assets, &update.assets).await?;
    let new_person = person::ActiveModel {
        name: ActiveValue::Set(update.name),
        place: ActiveValue::Set(update.place),
        assets: ActiveValue::Set(update.assets),
        gender: ActiveValue::Set(update.gender),
        website: ActiveValue::Set(update.website),
        id: ActiveValue::Unchanged(existing_person_id),
        birth_date: ActiveValue::Set(update.birth_date),
        death_date: ActiveValue::Set(update.death_date),
        description: ActiveValue::Set(update.description),
        alternate_names: ActiveValue::Set(update.alternate_names),
        ..Default::default()
    };
    new_person.update(&ss.db).await?;
    try_join!(
        expire_user_people_list_cache(user_id, ss),
        expire_person_details_cache(&person_model.id, ss)
    )?;
    Ok(true)
}

async fn delete_removed_s3_assets(
    ss: &Arc<SupportingService>,
    existing_assets: &EntityAssets,
    updated_assets: &EntityAssets,
) -> Result<()> {
    let (images_to_delete, videos_to_delete) = existing_assets.removed_s3_objects(updated_assets);
    for image in images_to_delete {
        file_storage_service::delete_object(ss, image).await?;
    }
    for video in videos_to_delete {
        file_storage_service::delete_object(ss, video).await?;
    }
    Ok(())
}

fn ensure_user_can_update_custom_entity(
    kind: &str,
    source: MediaSource,
    created_by_user_id: Option<String>,
    user_id: &str,
) -> Result<()> {
    if source != MediaSource::Custom {
        bail!("This {kind} is not custom and cannot be updated");
    }
    if created_by_user_id.as_deref() != Some(user_id) {
        bail!("You are not authorized to update this {kind}");
    }
    Ok(())
}

fn get_data_for_custom_metadata(
    input: CreateCustomMetadataInput,
    identifier: String,
    user_id: &str,
) -> metadata::ActiveModel {
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
        MediaLot::ComicBook => input.comic_book_specifics.is_none(),
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
        publish_date: ActiveValue::Set(input.publish_date),
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
        comic_book_specifics: ActiveValue::Set(input.comic_book_specifics),
        visual_novel_specifics: ActiveValue::Set(input.visual_novel_specifics),
        publish_year: ActiveValue::Set(
            input
                .publish_year
                .or_else(|| input.publish_date.map(|d| d.year())),
        ),
        ..Default::default()
    }
}

pub async fn handle_metadata_eligible_for_smart_collection_moving(
    ss: &Arc<SupportingService>,
    metadata_id: String,
) -> Result<()> {
    let meta = metadata_details(ss, &metadata_id).await?.response;
    if meta.lot != MediaLot::Show {
        return Ok(());
    }
    let users_with_both = CollectionEntityMembership::find()
        .select_only()
        .column(collection_entity_membership::Column::UserId)
        .filter(collection_entity_membership::Column::EntityId.eq(&metadata_id))
        .filter(collection_entity_membership::Column::CollectionName.is_in([
            DefaultCollection::Completed.to_string(),
            DefaultCollection::Monitoring.to_string(),
        ]))
        .group_by(collection_entity_membership::Column::UserId)
        .having(
            Expr::col(collection_entity_membership::Column::CollectionName)
                .count()
                .eq(2),
        )
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;

    for user_id in users_with_both {
        let (is_finished, _) = is_metadata_finished_by_user(&user_id, &metadata_id, ss).await?;
        if is_finished {
            continue;
        }

        try_join!(
            remove_entities_from_collection(
                &user_id,
                ChangeCollectionToEntitiesInput {
                    creator_user_id: user_id.clone(),
                    collection_name: DefaultCollection::Completed.to_string(),
                    entities: vec![EntityToCollectionInput {
                        information: None,
                        entity_id: meta.id.clone(),
                        entity_lot: EntityLot::Metadata,
                    }],
                },
                ss,
            ),
            add_entities_to_collection(
                &user_id,
                ChangeCollectionToEntitiesInput {
                    creator_user_id: user_id.clone(),
                    collection_name: DefaultCollection::Watchlist.to_string(),
                    entities: vec![EntityToCollectionInput {
                        information: None,
                        entity_id: meta.id.clone(),
                        entity_lot: EntityLot::Metadata,
                    }],
                },
                ss,
            ),
            send_notification_for_user(
                &user_id,
                ss,
                UserNotificationContent::MetadataMovedFromCompletedToWatchlistCollection {
                    entity_id: meta.id.clone(),
                    entity_lot: EntityLot::Metadata,
                    entity_title: meta.title.clone(),
                },
            )
        )?;
    }

    Ok(())
}
