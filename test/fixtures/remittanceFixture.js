import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { ensureConnection } from '../setup.js';
import User from '../../models/UserModel.js';
import Member from '../../models/MemberModel.js';
import Collection from '../../models/CollectionModel.js';
import Payment from '../../models/PaymentModel.js';
import Remittance from '../../models/RemittanceModel.js';
import CollectionLock from '../../models/CollectionLockModel.js';
import Notification from '../../models/NotificationModel.js';

/**
 * A club with real documents in the test database, for spec 009 tests that
 * depend on how MongoDB resolves concurrent writes. Everything it creates is
 * tagged with a unique suffix and removed by `cleanup()`.
 *
 * - admin, admin2: admins of the club
 * - member: a member (the usual recipient)
 * - outsider: signed in, not in the club
 * - otherMember: a member of another club
 * - collection: public, ₱12,000 verified (5,000 + 5,000 + 2,000), ₱1,000 pending
 */
export async function seedRemittanceClub({ visibility = 'public' } = {}) {
  await ensureConnection();
  const tag = new mongoose.Types.ObjectId().toString().slice(-8);
  const clubId = new mongoose.Types.ObjectId();
  const otherClubId = new mongoose.Types.ObjectId();

  const makeUser = (name, extra = {}) =>
    User.create({
      email: `${name}-${tag}@remit.test`,
      username: `${name}-${tag}`,
      password: 'x',
      ...extra,
    });
  const [admin, admin2, member, outsider, otherMember] = await Promise.all([
    makeUser('admin'),
    makeUser('admin2'),
    makeUser('member', { firstName: 'Juan', lastName: 'Dela Cruz' }),
    makeUser('outsider'),
    makeUser('other'),
  ]);

  const [, , memberDoc, , otherMemberDoc] = await Member.create([
    { user: admin._id, club: clubId, roles: ['member', 'admin'] },
    { user: admin2._id, club: clubId, roles: ['member', 'admin'] },
    { user: member._id, club: clubId, roles: ['member'] },
    { user: outsider._id, club: otherClubId, roles: ['member'] },
    { user: otherMember._id, club: otherClubId, roles: ['member'] },
  ]);

  const collection = await Collection.create({
    club: clubId,
    name: `QA Dues ${tag}`,
    visibility,
    createdBy: admin._id,
  });

  const payment = (amount, status, ref) => ({
    collection: collection._id,
    club: clubId,
    name: 'Payer',
    amount,
    referenceNumber: `${ref}${tag}`,
    status,
  });
  const payments = await Payment.create([
    payment(5000, 'confirmed', 'A'),
    payment(5000, 'confirmed', 'B'),
    payment(2000, 'confirmed', 'C'),
    payment(1000, 'pending', 'D'),
  ]);

  const tokenFor = (user) =>
    jwt.sign({ _id: user._id.toString() }, process.env.JWT_SECRET);

  async function cleanup() {
    const userIds = [admin, admin2, member, outsider, otherMember].map((u) => u._id);
    await Promise.all([
      User.deleteMany({ _id: { $in: userIds } }),
      Member.deleteMany({ club: { $in: [clubId, otherClubId] } }),
      Collection.deleteMany({ club: clubId }),
      Payment.deleteMany({ club: clubId }),
      Remittance.deleteMany({ club: clubId }),
      CollectionLock.deleteMany({ _id: collection._id }),
      Notification.deleteMany({ recipient: { $in: userIds } }),
    ]);
  }

  return {
    clubId,
    otherClubId,
    users: { admin, admin2, member, outsider, otherMember },
    memberDoc,
    otherMemberDoc,
    collection,
    payments,
    tokenFor,
    cleanup,
  };
}
