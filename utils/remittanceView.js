/**
 * What each viewer may see of a remittance (spec 009 D3, D4, D6; research R4).
 * Records are filtered in the query, so hidden ones never leave the server.
 * Recipient account details, the proof photo and who recorded or voided it go
 * only to the club's admins. The member and user links and the photo's storage
 * id are internal and never sent.
 */

const PUBLIC_FIELDS = [
  '_id',
  'collection',
  'club',
  'amount',
  'remittedOn',
  'recipientType',
  'recipientName',
  'note',
  'visibility',
  'status',
  'createdAt',
  'updatedAt',
];

const PRIVATE_FIELDS = [
  'recipientAccount',
  'proofUrl',
  'recordedBy',
  'voidedBy',
  'voidedAt',
  'voidReason',
];

/**
 * Query filter for the records a viewer may see. Non-members of a
 * members-only collection are refused before this, so there Public reads as
 * Members (D3).
 * @param {{ isAdmin: boolean, isMember: boolean }} viewer
 */
export function visibleTo({ isAdmin, isMember }) {
  if (isAdmin) return {};
  if (isMember) {
    return { status: 'active', visibility: { $in: ['members', 'public'] } };
  }
  return { status: 'active', visibility: 'public' };
}

/**
 * @param {object} remittance Mongoose document or plain object
 * @param {{ isAdmin?: boolean }} viewer
 */
export function serializeRemittance(remittance, { isAdmin = false } = {}) {
  const source =
    typeof remittance.toObject === 'function'
      ? remittance.toObject()
      : remittance;

  const out = {};
  for (const field of PUBLIC_FIELDS) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  out.detailsVisible = isAdmin;

  if (isAdmin) {
    for (const field of PRIVATE_FIELDS) {
      if (source[field] !== undefined) out[field] = source[field];
    }
  }
  return out;
}
