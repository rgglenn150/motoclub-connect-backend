import mongoose from 'mongoose';
import Member from '../models/MemberModel.js';
import { isValidAmount } from './amount.js';

/**
 * Checks a new remittance's fields (spec 009 FR-004, FR-005; contracts POST
 * create). Returns every failing field at once, like the collection edit check
 * (spec 006), plus the values to store. Ownership is resolved here: a member
 * recipient must belong to the collection's club, and their name is
 * snapshotted (D12).
 */

const RECIPIENT_TYPES = ['member', 'external'];
const VISIBILITIES = ['admins', 'members', 'public'];
const NOTE_MAX = 500;
const NAME_MAX = 100;
const ACCOUNT_MAX = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today in the Philippines as YYYY-MM-DD (research R3). */
export function todayInManila(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A real calendar date: rejects 2026-02-30 and the like. */
function isCalendarDate(text) {
  if (!DATE_PATTERN.test(text)) return false;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Same display name rule as the club members list (getClubMembers). */
function memberDisplayName(user) {
  return (
    user.username ||
    `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
    'Unnamed User'
  );
}

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {object} body request body (multipart fields arrive as strings)
 * @param {{ club: mongoose.Types.ObjectId }} collection
 * @returns {Promise<{ errors: Record<string,string>, values: object }>}
 */
export async function checkRemittance(body, { club }) {
  const errors = {};
  const values = {};

  if (isValidAmount(body.amount)) values.amount = Number(body.amount);
  else
    errors.amount =
      'Enter an amount above ₱0 with at most 2 decimals, up to ₱10,000,000.';

  const remittedOn = trimmed(body.remittedOn) || todayInManila();
  if (!isCalendarDate(remittedOn)) errors.remittedOn = 'Enter a valid date.';
  else if (remittedOn > todayInManila())
    errors.remittedOn = "The date can't be in the future.";
  else values.remittedOn = remittedOn;

  const note = trimmed(body.note);
  if (note.length > NOTE_MAX)
    errors.note = `Keep the note under ${NOTE_MAX} characters.`;
  else if (note) values.note = note;

  const visibility = trimmed(body.visibility) || 'members';
  if (VISIBILITIES.includes(visibility)) values.visibility = visibility;
  else errors.visibility = 'Visibility must be admins, members or public.';

  const recipientType = trimmed(body.recipientType);
  if (!RECIPIENT_TYPES.includes(recipientType)) {
    errors.recipientType = 'Choose a club member or an external recipient.';
  } else {
    values.recipientType = recipientType;
    if (recipientType === 'member') {
      const memberId = trimmed(body.memberId);
      const member = mongoose.isValidObjectId(memberId)
        ? await Member.findOne({ _id: memberId, club }).populate(
            'user',
            'username firstName lastName'
          )
        : null;
      if (!member?.user) {
        errors.memberId = 'Pick a member of this club.';
      } else {
        values.member = member._id;
        values.recipientUser = member.user._id;
        values.recipientName = memberDisplayName(member.user);
      }
    } else {
      const recipientName = trimmed(body.recipientName);
      if (!recipientName) errors.recipientName = "Enter the recipient's name.";
      else if (recipientName.length > NAME_MAX)
        errors.recipientName = `Keep the name under ${NAME_MAX} characters.`;
      else values.recipientName = recipientName;
    }
  }

  // Account details belong to external recipients only, and only admins see them (D6).
  const recipientAccount = trimmed(body.recipientAccount);
  if (recipientAccount) {
    if (recipientType !== 'external')
      errors.recipientAccount = 'Account details are for external recipients only.';
    else if (recipientAccount.length > ACCOUNT_MAX)
      errors.recipientAccount = `Keep the account details under ${ACCOUNT_MAX} characters.`;
    else values.recipientAccount = recipientAccount;
  }

  return { errors, values };
}
