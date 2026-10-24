import mongoose from 'mongoose';
const { Schema } = mongoose;

// Per-collection lease lock (spec 009, research R1). `_id` is the collection's
// id; a lock whose `until` has passed is free. Internal only, never sent.
const collectionLockSchema = new Schema({
  _id:   { type: Schema.Types.ObjectId },
  until: { type: Date, required: true },
}, { versionKey: false });

export default mongoose.model('CollectionLock', collectionLockSchema);
