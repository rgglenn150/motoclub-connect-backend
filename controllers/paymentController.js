import Payment from '../models/PaymentModel.js';
import Collection from '../models/CollectionModel.js';
import Member from '../models/MemberModel.js';
import cloudinary from '../utils/cloudinary.js';

export async function getPaymentsByCollection(req, res) {
  try {
    const { collectionId } = req.params;

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
    const { collection: collectionId, name, amount, referenceNumber: rawRef, phoneNumber, description, transactionDate } = req.body;

    if (!collectionId || !name || amount === undefined || !rawRef) {
      return res.status(400).json({ message: 'collection, name, amount, and referenceNumber are required' });
    }

    const referenceNumber = rawRef.replace(/[\s-]/g, '');

    const collection = await Collection.findById(collectionId);
    if (!collection) {
      return res.status(404).json({ message: 'Collection not found' });
    }

    const membership = await Member.findOne({ club: collection.club, user: req.user._id, roles: 'admin' });
    if (!membership) {
      return res.status(403).json({ message: 'Only club admins can add payments' });
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
      amount,
      referenceNumber,
      createdBy: req.user._id,
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

    if (!['pending', 'confirmed', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be pending, confirmed, or rejected.' });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    const membership = await Member.findOne({ club: payment.club, user: req.user._id, roles: 'admin' });
    if (!membership) {
      return res.status(403).json({ message: 'Only club admins can update payment status' });
    }

    payment.status = status;
    await payment.save();

    return res.status(200).json({ payment });
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

export async function extractReceiptData(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Receipt file is required' });
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
        model: 'google/gemini-2.0-flash-lite-001',
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
      amount: parsed.amount ?? null,
      referenceNumber: parsed.referenceNumber ?? null,
      phoneNumber: parsed.phoneNumber ?? null,
      transactionDateTime: parsed.transactionDateTime ?? null,
    });
  } catch (err) {
    console.error('Error extracting receipt data:', err.message);
    return res.status(500).json({ message: 'Failed to read receipt. Please fill in the fields manually.' });
  }
}
