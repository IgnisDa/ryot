use std::{collections::HashMap, hash::Hash};

pub trait GroupingKey {
    type Key;
    fn get_key(&self) -> Self::Key;
}

pub fn group_by_field<T>(items: Vec<T>) -> HashMap<T::Key, Vec<T>>
where
    T: GroupingKey,
    T::Key: Eq + Hash,
{
    let mut grouped_map: HashMap<T::Key, Vec<T>> = HashMap::new();

    for item in items {
        let key = item.get_key();
        grouped_map.entry(key).or_insert_with(Vec::new).push(item);
    }

    grouped_map
}
