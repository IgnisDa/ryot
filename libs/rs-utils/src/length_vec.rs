use std::ops::{Deref, DerefMut};

/// A fixed-length vector-like data structure that automatically removes the oldest element
/// when a new element is added, ensuring that the length of the vector does not exceed
/// the specified maximum capacity.
///
/// This data structure behaves like a regular `Vec`, but with a specific length. When you
/// push a new element into it and it reaches its capacity, it will remove the oldest element
/// to maintain the fixed length.
///
/// # Examples
/// ```
/// use length_vec::LengthVec;
///
/// let mut length_vec = LengthVec::new(5);
/// length_vec.push(1);
/// length_vec.push(2);
/// length_vec.push(3);
/// length_vec.push(4);
/// length_vec.push(5);
///
/// assert_eq!(length_vec.len(), 5);
/// assert_eq!(*length_vec, vec![1, 2, 3, 4, 5]);
///
/// length_vec.push(6);
/// assert_eq!(length_vec.len(), 5);
/// assert_eq!(*length_vec, vec![2, 3, 4, 5, 6]);
///
/// length_vec.push_front(0);
/// assert_eq!(length_vec.len(), 5);
/// assert_eq!(*length_vec, vec![0, 2, 3, 4, 5]);
/// ```
pub struct LengthVec<T> {
    data: Vec<T>,
    max_length: usize,
}

impl<T> LengthVec<T> {
    pub fn new(max_length: usize) -> Self {
        LengthVec {
            data: Vec::with_capacity(max_length),
            max_length,
        }
    }

    pub fn from_vec_and_length(data: Vec<T>, max_length: usize) -> Self {
        LengthVec { data, max_length }
    }

    pub fn push(&mut self, item: T) {
        if self.data.len() >= self.max_length {
            self.data.remove(0); // Remove the oldest element
        }
        self.data.push(item);
    }

    pub fn push_front(&mut self, item: T) {
        if self.data.len() >= self.max_length {
            self.data.pop(); // Remove the last element
        }
        self.data.insert(0, item);
    }

    pub fn into_vec(self) -> Vec<T> {
        self.data
    }
}

impl<T> Into<Vec<T>> for LengthVec<T> {
    fn into(self) -> Vec<T> {
        self.into_vec()
    }
}

impl<T> Deref for LengthVec<T> {
    type Target = Vec<T>;

    fn deref(&self) -> &Self::Target {
        &self.data
    }
}

impl<T> DerefMut for LengthVec<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.data
    }
}

#[cfg(test)]
mod tests {
    use super::LengthVec;

    #[test]
    fn test_push() {
        let mut length_vec = LengthVec::new(5);
        length_vec.push(1);
        length_vec.push(2);
        length_vec.push(3);
        length_vec.push(4);
        length_vec.push(5);

        assert_eq!(length_vec.len(), 5);
        assert_eq!(*length_vec, vec![1, 2, 3, 4, 5]);

        length_vec.push(6);
        assert_eq!(length_vec.len(), 5);
        assert_eq!(*length_vec, vec![2, 3, 4, 5, 6]);
    }

    #[test]
    fn test_push_front() {
        let mut length_vec = LengthVec::new(5);
        length_vec.push_front(5);
        length_vec.push_front(4);
        length_vec.push_front(3);
        length_vec.push_front(2);
        length_vec.push_front(1);

        assert_eq!(length_vec.len(), 5);
        assert_eq!(*length_vec, vec![1, 2, 3, 4, 5]);

        length_vec.push_front(0);
        assert_eq!(length_vec.len(), 5);
        assert_eq!(*length_vec, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn test_push_mixed() {
        let mut length_vec = LengthVec::new(5);
        length_vec.push(1);
        length_vec.push(2);
        length_vec.push_front(0);
        length_vec.push(3);
        length_vec.push_front(-1);
        length_vec.push(4);

        assert_eq!(length_vec.len(), 5);
        assert_eq!(*length_vec, vec![0, 1, 2, 3, 4]);
    }
}
