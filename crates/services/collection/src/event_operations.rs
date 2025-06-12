use std::{collections::HashSet, sync::Arc};

use async_graphql::{Error, Result};
use chrono::Utc;
use common_models::CollectionExtraInformationLot;
use database_models::{
    collection,
    prelude::{Collection, CollectionToEntity, UserToEntity},
    user_to_entity,
};
use dependent_utils::expire_user_collections_list_cache;
use futures::future::try_join_all;
use itertools::Itertools;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QuerySelect};
use supporting_service::SupportingService;
use uuid::Uuid;

pub async fn handle_entity_added_to_collection_event(
    collection_to_entity_id: Uuid,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let (cte, collection) = CollectionToEntity::find_by_id(collection_to_entity_id)
        .find_also_related(Collection)
        .one(&ss.db)
        .await?
        .ok_or_else(|| Error::new("Collection to entity does not exist"))?;
    let collection = collection.ok_or_else(|| Error::new("Collection does not exist"))?;
    let mut fields = collection.clone().information_template.unwrap_or_default();
    if !fields
        .iter()
        .any(|i| i.lot == CollectionExtraInformationLot::StringArray)
    {
        return Ok(());
    }
    let mut updated_needed = false;
    for field in fields.iter_mut() {
        if field.lot == CollectionExtraInformationLot::StringArray {
            let updated_values = cte
                .information
                .as_ref()
                .and_then(|v| v.get(field.name.clone()).and_then(|f| f.as_array()))
                .map(|f| {
                    f.iter()
                        .map(|v| v.as_str().unwrap_or_default())
                        .collect_vec()
                });
            if let Some(updated_values) = updated_values {
                let mut current_possible_values: HashSet<String> =
                    HashSet::from_iter(field.possible_values.clone().unwrap_or_default());
                let old_size = current_possible_values.len();
                for value in updated_values {
                    current_possible_values.insert(value.to_string());
                }
                if current_possible_values.len() != old_size {
                    field.possible_values = Some(current_possible_values.into_iter().collect_vec());
                    updated_needed = true;
                }
            }
        }
    }
    if !updated_needed {
        return Ok(());
    }
    let mut col: collection::ActiveModel = collection.into();
    col.information_template = ActiveValue::Set(Some(fields));
    col.last_updated_on = ActiveValue::Set(Utc::now());
    col.update(&ss.db).await?;
    let users = UserToEntity::find()
        .select_only()
        .column(user_to_entity::Column::UserId)
        .filter(user_to_entity::Column::CollectionId.eq(&cte.collection_id))
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    try_join_all(
        users
            .into_iter()
            .map(|user| async move { expire_user_collections_list_cache(&user, ss).await }),
    )
    .await?;
    Ok(())
}
