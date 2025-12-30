import Event from '../models/EventModel.js';
import Member from '../models/MemberModel.js';
import { validationResult } from 'express-validator';
import cloudinary from '../utils/cloudinary.js';
import sharp from 'sharp';

export async function createEvent(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, description, startTime, endTime, location, geolocation, eventType, club, imageUrl, imagePublicId, isPrivate } =
    req.body;
  console.log('Creating event with data:', req.body);
  try {
    // Build geolocation object if provided
    const geolocationData = {};
    if (geolocation) {
      if (geolocation.latitude !== undefined) {
        geolocationData.latitude = geolocation.latitude;
      }
      if (geolocation.longitude !== undefined) {
        geolocationData.longitude = geolocation.longitude;
      }
      if (geolocation.placeName !== undefined) {
        geolocationData.placeName = geolocation.placeName;
      }
    }

    const newEvent = new Event({
      name,
      description,
      startTime,
      endTime,
      location,
      ...(Object.keys(geolocationData).length > 0 && { geolocation: geolocationData }),
      eventType,
      club,
      createdBy: req.user._id,
      ...(imageUrl && { imageUrl }),
      ...(imagePublicId && { imagePublicId }),
      ...(isPrivate !== undefined && { isPrivate }),
    });

    await newEvent.save();
    res.status(201).json(newEvent);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
}

export async function getAllEvents(req, res) {
  try {
    const events = await Event.find()
      .populate('club', 'clubName')
      .populate('createdBy', 'username');
    res.status(200).json(events);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
}

export async function getEventsByClub(req, res) {
  try {
    const events = await Event.find({ club: req.params.clubId }).populate(
      'createdBy',
      'username'
    );
    res.status(200).json(events);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
}

/**
 * Get all events from clubs that the authenticated user is a member of.
 * Requires authentication via authMiddleware.
 * Returns events sorted by startTime (ascending - upcoming events first).
 */
export async function getMyClubEvents(req, res) {
  try {
    // Get authenticated user ID from middleware
    const userId = req.user._id;

    // Find all clubs where the user is a member
    const memberships = await Member.find({ user: userId });

    // If user is not a member of any clubs, return empty array
    if (!memberships || memberships.length === 0) {
      return res.status(200).json([]);
    }

    // Extract club IDs from memberships
    const clubIds = memberships.map((membership) => membership.club);

    // Find all events from those clubs
    const events = await Event.find({
      club: { $in: clubIds },
      isPrivate: false  // Only show public events
    })
      .populate('club', 'clubName')
      .populate('createdBy', 'username')
      .sort({ startTime: 1 });

    res.status(200).json(events);
  } catch (err) {
    console.error('Error fetching my club events:', err.message);
    res.status(500).json({
      message: 'Server Error',
      error: err.message
    });
  }
}

/**
 * Uploads an event image to Cloudinary and stores the resulting URL on the event.
 * Expects a multipart/form-data request with field name 'eventImage'.
 */
export async function uploadEventImage(req, res) {
  try {
    const { eventId } = req.params;

    if (!req.file) {
      return res
        .status(400)
        .json({ message: 'Event image file is required (field name: eventImage)' });
    }

    // Validate eventId format
    if (!eventId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid event ID format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Process image with sharp - limit to 1024x768, 85% quality JPEG
    const processedImageBuffer = await sharp(req.file.buffer)
      .resize(1024, 768, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    // Convert processed buffer to base64 data URI to avoid temp files
    const base64 = `data:image/jpeg;base64,${processedImageBuffer.toString('base64')}`;

    // Delete existing image if it exists
    if (event.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(event.imagePublicId);
      } catch (deleteError) {
        console.warn('Failed to delete existing event image:', deleteError);
        // Continue with upload even if deletion fails
      }
    }

    const uploadResult = await cloudinary.uploader.upload(base64, {
      folder: 'motoclub-connect/events',
      public_id: `event_${eventId}_image`,
      overwrite: true,
      resource_type: 'image',
      transformation: [{ width: 1024, height: 768, crop: 'limit' }],
    });

    event.imageUrl = uploadResult.secure_url;
    event.imagePublicId = uploadResult.public_id;
    await event.save();

    return res.status(200).json({
      message: 'Event image uploaded successfully',
      imageUrl: event.imageUrl,
      publicId: event.imagePublicId,
    });
  } catch (error) {
    console.error('Error uploading event image:', error);
    return res
      .status(500)
      .json({
        message: 'Error uploading event image',
        error: error?.message || error,
      });
  }
}
