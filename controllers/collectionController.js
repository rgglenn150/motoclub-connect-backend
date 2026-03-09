import Collection from '../models/CollectionModel.js';
import Payment from '../models/PaymentModel.js';
import Member from '../models/MemberModel.js';
import cloudinary from '../utils/cloudinary.js';

async function isClubAdmin(clubId, userId) {
  const membership = await Member.findOne({ club: clubId, user: userId, roles: 'admin' });
  return !!membership;
}

export async function getCollectionsByClub(req, res) {
  try {
    const { clubId } = req.params;

    const collections = await Collection.find({ club: clubId })
      .sort({ createdAt: -1 })
      .lean();

    // For each collection, compute totalCollected and paymentCount
    const enriched = await Promise.all(
      collections.map(async (col) => {
        const [paymentCount, totalResult] = await Promise.all([
          Payment.countDocuments({ collection: col._id }),
          Payment.aggregate([
            { $match: { collection: col._id } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]),
        ]);
        return {
          ...col,
          paymentCount,
          totalCollected: totalResult[0]?.total ?? 0,
        };
      })
    );

    return res.status(200).json({ collections: enriched });
  } catch (err) {
    console.error('Error fetching collections:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

export async function createCollection(req, res) {
  try {
    const { club, name, description, targetAmount } = req.body;

    if (!club || !name) {
      return res.status(400).json({ message: 'club and name are required' });
    }

    if (!(await isClubAdmin(club, req.user._id))) {
      return res.status(403).json({ message: 'Only club admins can create collections' });
    }

    const collection = new Collection({
      club,
      name,
      ...(description && { description }),
      ...(targetAmount !== undefined && { targetAmount }),
      createdBy: req.user._id,
    });

    await collection.save();

    // Return with computed fields
    const result = { ...collection.toObject(), paymentCount: 0, totalCollected: 0 };
    return res.status(201).json({ collection: result });
  } catch (err) {
    console.error('Error creating collection:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

export async function updateCollection(req, res) {
  try {
    const { collectionId } = req.params;
    const { name, description, targetAmount, status } = req.body;

    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    if (!(await isClubAdmin(collection.club, req.user._id))) {
      return res.status(403).json({ message: 'Only club admins can update collections' });
    }

    if (name !== undefined) collection.name = name;
    if (description !== undefined) collection.description = description;
    if (targetAmount !== undefined) collection.targetAmount = targetAmount;
    if (status !== undefined) collection.status = status;

    await collection.save();
    return res.status(200).json({ collection });
  } catch (err) {
    console.error('Error updating collection:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

export async function deleteCollection(req, res) {
  try {
    const { collectionId } = req.params;

    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    if (!(await isClubAdmin(collection.club, req.user._id))) {
      return res.status(403).json({ message: 'Only club admins can delete collections' });
    }

    // Cascade: delete all payments and their Cloudinary receipts
    const payments = await Payment.find({ collection: collectionId });
    await Promise.all(
      payments.map(async (p) => {
        if (p.receiptPublicId) {
          try {
            await cloudinary.uploader.destroy(p.receiptPublicId);
          } catch (e) {
            console.warn('Failed to delete receipt from Cloudinary:', e);
          }
        }
      })
    );
    await Payment.deleteMany({ collection: collectionId });
    await collection.deleteOne();

    return res.status(200).json({ message: 'Collection deleted' });
  } catch (err) {
    console.error('Error deleting collection:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}
