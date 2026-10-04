/**
 * What each viewer may see of a payment (spec 003 FR-013, FR-014; contracts §1).
 * Name, amount, status and dates are public to anyone who can see the
 * collection. Private details go only to the club's admins and to the
 * signed-in member who submitted the payment. The receipt's storage id is
 * internal and never sent.
 */

const PUBLIC_FIELDS = [
  '_id',
  'collection',
  'club',
  'name',
  'amount',
  'status',
  'transactionDate',
  'createdAt',
  'updatedAt',
];

const PRIVATE_FIELDS = [
  'accountName',
  'referenceNumber',
  'phoneNumber',
  'description',
  'receiptUrl',
  'createdBy',
];

/** createdBy may be populated ({ _id, username }), a bare id, or empty. */
function submitterId(createdBy) {
  if (!createdBy) return null;
  return String(createdBy._id ?? createdBy);
}

/**
 * @param {object} payment Mongoose document or plain object
 * @param {{ isAdmin?: boolean, viewerId?: string|null }} viewer
 */
export function serializePayment(
  payment,
  { isAdmin = false, viewerId = null } = {}
) {
  const source =
    typeof payment.toObject === 'function' ? payment.toObject() : payment;
  const ownerId = submitterId(source.createdBy);
  const detailsVisible =
    isAdmin ||
    (viewerId != null && ownerId != null && ownerId === String(viewerId));

  const out = {};
  for (const field of PUBLIC_FIELDS) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  out.detailsVisible = detailsVisible;

  if (detailsVisible) {
    for (const field of PRIVATE_FIELDS) {
      if (source[field] !== undefined) out[field] = source[field];
    }
    // Explicit null: "submitted while signed out", not "hidden".
    if (out.createdBy === undefined) out.createdBy = null;
  }
  return out;
}
