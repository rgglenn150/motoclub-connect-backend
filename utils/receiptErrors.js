// Coded errors for receipt uploads (spec 008, contracts/README.md). The app
// switches on `code` and shows `message` as is.
export const RECEIPT_ERRORS = {
  FILE_TOO_LARGE: {
    status: 413,
    message:
      'This photo is too large. Try a screenshot of the receipt instead.',
  },
  UNSUPPORTED_FORMAT: {
    status: 415,
    message:
      "This photo format isn't supported. Try a screenshot or a JPEG/PNG image.",
  },
  READER_UNAVAILABLE: {
    status: 503,
    message:
      'Receipt reading is unavailable right now. Please fill in the fields manually.',
  },
  UNREADABLE: {
    status: 422,
    message: "Couldn't read this receipt. Please fill in the fields manually.",
  },
};

/** Image types the receipt reader accepts (research R4). */
export const READER_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export function sendReceiptError(res, code) {
  const { status, message } = RECEIPT_ERRORS[code];
  return res.status(status).json({ code, message });
}
