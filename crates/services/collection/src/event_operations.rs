use std::{collections::HashSet, sync::Arc};

use anyhow::{Result, anyhow};
use chrono::Utc;
use common_models::{CollectionExtraInformation, CollectionExtraInformationLot};
use database_models::{
    prelude::{Collection, CollectionToEntity, UserToEntity},
    user_to_entity,
};
use dependent_utility_utils::expire_user_collections_list_cache;
use futures::future::try_join_all;
use itertools::Itertools;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QuerySelect,
};
use supporting_service::SupportingService;
use uuid::Uuid;

fn update_possible_values(
    field: &mut CollectionExtraInformation,
    new_values: impl IntoIterator<Item = String>,
) -> bool {
    let mut current_possible_values: HashSet<String> =
        HashSet::from_iter(field.possible_values.clone().unwrap_or_default());
    let mut changed = false;
    for value in new_values {
        if current_possible_values.insert(value) {
            changed = true;
        }
    }
    if changed {
        field.possible_values = Some(current_possible_values.into_iter().collect_vec());
    }
    changed
}

pub async fn handle_entity_added_to_collection_event(
    collection_to_entity_id: Uuid,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let (cte, collection) = CollectionToEntity::find_by_id(collection_to_entity_id)
        .find_also_related(Collection)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Collection to entity does not exist"))?;
    let collection = collection.ok_or_else(|| anyhow!("Collection does not exist"))?;
    let mut fields = collection.clone().information_template.unwrap_or_default();
    let mut updated_needed = false;
    for field in fields.iter_mut() {
        match field.lot {
            CollectionExtraInformationLot::StringArray => {
                if let Some(values) = cte
                    .information
                    .as_ref()
                    .and_then(|v| v.get(&field.name).and_then(|f| f.as_array()))
                {
                    let string_values = values
                        .iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect_vec();
                    if update_possible_values(field, string_values) {
                        updated_needed = true;
                    }
                }
            }
            CollectionExtraInformationLot::String => {
                if let Some(value) = cte
                    .information
                    .as_ref()
                    .and_then(|v| v.get(&field.name).and_then(|f| f.as_str()))
                    && update_possible_values(field, [value.to_string()])
                {
                    updated_needed = true;
                }
            }
            _ => {}
        }
    }
    if !updated_needed {
        return Ok(());
    }
    let mut col = collection.into_active_model();
    col.last_updated_on = ActiveValue::Set(Utc::now());
    col.information_template = ActiveValue::Set(Some(fields));
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
