use async_graphql::{Error, Result};
use common_models::{ChangeCollectionToEntityInput, DefaultCollection};
use database_models::{
    metadata, metadata_to_genre,
    prelude::{Metadata, MetadataToGenre},
};
use dependent_utils::{add_entity_to_collection, change_metadata_associations};
use enum_models::{EntityLot, MediaSource};
use media_models::{CreateCustomMetadataInput, UpdateCustomMetadataInput};
use nanoid::nanoid;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter};
use supporting_service::SupportingService;

pub async fn create_custom_metadata(
    supporting_service: &std::sync::Arc<SupportingService>,
    user_id: String,
    input: CreateCustomMetadataInput,
    get_data_for_custom_metadata: impl Fn(
        CreateCustomMetadataInput,
        String,
        &str,
    ) -> metadata::ActiveModel,
) -> Result<metadata::Model> {
    let identifier = nanoid!(10);
    let metadata = get_data_for_custom_metadata(input.clone(), identifier, &user_id);
    let metadata = metadata.insert(&supporting_service.db).await?;
    change_metadata_associations(
        &metadata.id,
        input.genres.unwrap_or_default(),
        vec![],
        vec![],
        vec![],
        supporting_service,
    )
    .await?;
    add_entity_to_collection(
        &user_id,
        ChangeCollectionToEntityInput {
            entity_id: metadata.id.clone(),
            entity_lot: EntityLot::Metadata,
            creator_user_id: user_id.to_owned(),
            collection_name: DefaultCollection::Custom.to_string(),
            ..Default::default()
        },
        supporting_service,
    )
    .await?;
    Ok(metadata)
}

pub async fn update_custom_metadata(
    supporting_service: &std::sync::Arc<SupportingService>,
    user_id: &str,
    input: UpdateCustomMetadataInput,
    get_data_for_custom_metadata: impl Fn(
        CreateCustomMetadataInput,
        String,
        &str,
    ) -> metadata::ActiveModel,
) -> Result<bool> {
    let metadata = Metadata::find_by_id(&input.existing_metadata_id)
        .one(&supporting_service.db)
        .await?
        .unwrap();
    if metadata.source != MediaSource::Custom {
        return Err(Error::new(
            "This metadata is not custom and cannot be updated",
        ));
    }
    if metadata.created_by_user_id != Some(user_id.to_owned()) {
        return Err(Error::new("You are not authorized to update this metadata"));
    }
    MetadataToGenre::delete_many()
        .filter(metadata_to_genre::Column::MetadataId.eq(&input.existing_metadata_id))
        .exec(&supporting_service.db)
        .await?;
    for image in metadata.assets.s3_images.clone() {
        supporting_service
            .file_storage_service
            .delete_object(image)
            .await;
    }
    for video in metadata.assets.s3_videos.clone() {
        supporting_service
            .file_storage_service
            .delete_object(video)
            .await;
    }
    let mut new_metadata =
        get_data_for_custom_metadata(input.update.clone(), metadata.identifier, user_id);
    new_metadata.id = ActiveValue::Unchanged(input.existing_metadata_id);
    let metadata = new_metadata.update(&supporting_service.db).await?;
    change_metadata_associations(
        &metadata.id,
        input.update.genres.unwrap_or_default(),
        vec![],
        vec![],
        vec![],
        supporting_service,
    )
    .await?;
    Ok(true)
}
