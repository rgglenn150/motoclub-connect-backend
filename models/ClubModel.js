import mongoose from 'mongoose';
const { Schema } = mongoose;

const clubSchema = new Schema(
  {
    clubName: {
      type: String,
      required: true,
    },
    Description: {
      type: String,
    },
    members: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Member',
      },
    ],
  },
  {
    timestamps: true,
  }
);

export default mongoose.model('Club', clubSchema);
