import Payment from '../models/PaymentModel.js';
import Collection from '../models/CollectionModel.js';
import Member from '../models/MemberModel.js';
import cloudinary from '../utils/cloudinary.js';

export async function getPaymentsByCollection(req, res) {
  try {
    const { collectionId } = req.params;

    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    if (collection.visibility === 'members_only') {
      const membership = req.user ? await Member.findOne({ club: collection.club, user: req.user._id }) : null;
      if (!membership) {
        return res.status(403).json({ message: 'Access restricted to club members' });
      }
    }

    const payments = await Payment.find({ collection: collectionId })
      .populate('createdBy', 'username')
      .sort({ createdAt: -1 });

    return res.status(200).json({ payments });
  } catch (err) {
    console.error('Error fetching payments:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

export async function createPayment(req, res) {
  try {
    const { collection: collectionId, name, accountName, amount, referenceNumber: rawRef, phoneNumber, description, transactionDate } = req.body;

    if (!collectionId || !name || amount === undefined || !rawRef) {
      return res.status(400).json({ message: 'collection, name, amount, and referenceNumber are required' });
    }

    const referenceNumber = rawRef.replace(/[\s-]/g, '');

    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    if (collection.visibility !== 'public') {
      if (!req.user) return res.status(401).json({ message: 'Authentication required' });
      const membership = await Member.findOne({ club: collection.club, user: req.user._id, roles: 'admin' });
      if (!membership) return res.status(403).json({ message: 'Only club admins can add payments' });
    }

    const duplicate = await Payment.findOne({ collection: collectionId, referenceNumber });
    if (duplicate) {
      return res.status(409).json({ message: `Reference number "${referenceNumber}" already exists in this collection.` });
    }

    let receiptUrl;
    let receiptPublicId;

    if (req.file) {
      const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      const uploadResult = await cloudinary.uploader.upload(base64, {
        folder: 'payments',
        resource_type: 'image',
      });
      receiptUrl = uploadResult.secure_url;
      receiptPublicId = uploadResult.public_id;
    }

    const payment = new Payment({
      collection: collectionId,
      club: collection.club,
      name,
      ...(accountName && { accountName }),
      amount,
      referenceNumber,
      ...(req.user && { createdBy: req.user._id }),
      ...(phoneNumber && { phoneNumber }),
      ...(description && { description }),
      transactionDate: transactionDate ? new Date(transactionDate) : new Date(),
      ...(receiptUrl && { receiptUrl }),
      ...(receiptPublicId && { receiptPublicId }),
    });

    await payment.save();

    return res.status(201).json({ payment });
  } catch (err) {
    console.error('Error creating payment:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

export async function updatePaymentStatus(req, res) {
  try {
    const { paymentId } = req.params;
    const { status } = req.body;

    // Payments only move forward: pending → confirmed | rejected (constitution
    // VII, spec 001 FR-016). A mistaken resolution is fixed by deleting the payment.
    if (!['confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be confirmed or rejected.' });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    const membership = await Member.findOne({ club: payment.club, user: req.user._id, roles: 'admin' });
    if (!membership) {
      return res.status(403).json({ message: 'Only club admins can update payment status' });
    }

    const alreadyResolved = (current) =>
      res.status(409).json({ message: `Payment is already ${current} and can't be changed.`, status: current });

    if (payment.status !== 'pending') {
      return alreadyResolved(payment.status);
    }

    // Conditional update so two admins can't resolve the same payment differently.
    const updated = await Payment.findOneAndUpdate(
      { _id: paymentId, status: 'pending' },
      { status },
      { new: true }
    );
    if (!updated) {
      const current = await Payment.findById(paymentId);
      if (!current) {
        return res.status(404).json({ message: 'Payment not found' });
      }
      return alreadyResolved(current.status);
    }

    return res.status(200).json({ payment: updated });
  } catch (err) {
    console.error('Error updating payment status:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

export async function deletePayment(req, res) {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    const membership = await Member.findOne({
      club: payment.club,
      user: req.user._id,
      roles: 'admin',
    });

    if (!membership) {
      return res.status(403).json({ message: 'Only club admins can delete payments' });
    }

    if (payment.receiptPublicId) {
      try {
        await cloudinary.uploader.destroy(payment.receiptPublicId);
      } catch (deleteError) {
        console.warn('Failed to delete receipt from Cloudinary:', deleteError);
      }
    }

    await payment.deleteOne();

    return res.status(200).json({ message: 'Payment deleted' });
  } catch (err) {
    console.error('Error deleting payment:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

// Vision model used for receipt OCR. Overridable via env so a retired model can
// be swapped without a code change — OpenRouter returns 404 once a model is
// pulled (google/gemini-2.0-flash-lite-001 was retired this way).
const RECEIPT_MODEL =
  process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite';

// The model returns the amount as text often enough ("PHP 1,250.00", "1,250.00")
// that it has to be coerced here — the client binds it straight to a number field.
function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function extractReceiptData(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Receipt file is required' });
    }

    if (!process.env.OPENROUTER_API_KEY) {
      console.error('OPENROUTER_API_KEY is not set; receipt scanning is disabled');
      return res.status(503).json({ message: 'Receipt scanning is unavailable. Please fill in the fields manually.' });
    }

    const base64Image = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64Image}`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: RECEIPT_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: 'Extract from this payment receipt: name (payer name), amount (number only, no currency symbols), referenceNumber, phoneNumber (payer phone number if present), transactionDateTime (ISO 8601 datetime string if present, include time if available e.g. 2024-03-08T14:30:00, or 2024-03-08T00:00:00 if only date is found). Return ONLY valid JSON: {"name": ..., "amount": ..., "referenceNumber": ..., "phoneNumber": ..., "transactionDateTime": ...}. Use null for any field not found.' },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      console.error('OpenRouter error:', response.status, errBody);
      if (response.status === 429) {
        return res.status(429).json({ message: 'AI quota exceeded. Please fill in the fields manually.' });
      }
      if (response.status === 404) {
        console.error(
          `Model "${RECEIPT_MODEL}" is unavailable on OpenRouter (likely retired). Set OPENROUTER_MODEL to a current vision model.`
        );
      }
      if (response.status === 401 || response.status === 403) {
        console.error('OpenRouter rejected the API key. Check OPENROUTER_API_KEY.');
      }
      return res.status(502).json({ message: 'Failed to read receipt. Please fill in the fields manually.' });
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? '';

    let parsed;
    try {
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (_) {
      parsed = { name: null, amount: null, referenceNumber: null, phoneNumber: null, transactionDateTime: null };
    }

    return res.status(200).json({
      name: parsed.name ?? null,
      amount: parseAmount(parsed.amount),
      referenceNumber: parsed.referenceNumber ?? null,
      phoneNumber: parsed.phoneNumber ?? null,
      transactionDateTime: parsed.transactionDateTime ?? null,
    });
  } catch (err) {
    console.error('Error extracting receipt data:', err.message);
    return res.status(500).json({ message: 'Failed to read receipt. Please fill in the fields manually.' });
  }
}
