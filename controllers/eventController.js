import Event from '../models/EventModel.js';
import Member from '../models/MemberModel.js';
import Notification from '../models/NotificationModel.js';
import { validationResult } from 'express-validator';
import cloudinary from '../utils/cloudinary.js';
import sharp from 'sharp';

function getUserDisplayName(user) {
  if (!user) return 'Unknown User';
  return (
    user.username ||
    (user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.name || 'Unknown User')
  );
}

export async function createEvent(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    name,
    description,
    startTime,
    endTime,
    location,
    geolocation,
    eventType,
    club,
    imageUrl,
    imagePublicId,
    isPrivate,
    scope,
    maxAttendees,
  } = req.body;
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

    const eventScope = scope === 'global' ? 'global' : 'club';

    // Validate maxAttendees if provided
    let normalizedMax = null;
    if (maxAttendees !== undefined && maxAttendees !== null && maxAttendees !== '') {
      const n = parseInt(maxAttendees, 10);
      if (isNaN(n) || n <= 0) {
        return res
          .status(400)
          .json({ message: 'maxAttendees must be a positive integer or null' });
      }
      normalizedMax = n;
    }

    const eventDoc = {
      name,
      description,
      startTime,
      endTime,
      location,
      ...(Object.keys(geolocationData).length > 0 && { geolocation: geolocationData }),
      eventType,
      createdBy: req.user._id,
      scope: eventScope,
      ...(imageUrl && { imageUrl }),
      ...(imagePublicId && { imagePublicId }),
    };

    if (eventScope === 'global') {
      eventDoc.isPrivate = false;
      eventDoc.attendees = [req.user._id];
      eventDoc.attendeeCount = 1;
      eventDoc.maxAttendees = normalizedMax;
      // ignore club for global events
    } else {
      eventDoc.club = club;
      if (isPrivate !== undefined) eventDoc.isPrivate = isPrivate;
      if (normalizedMax !== null) eventDoc.maxAttendees = normalizedMax;
    }

    const newEvent = new Event(eventDoc);
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

    // Parse & clamp pagination params
    let page = parseInt(req.query.page, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 50) limit = 50;

    // Parse filter
    const allowedFilters = ['upcoming', 'past', 'all'];
    const filter = allowedFilters.includes(req.query.filter) ? req.query.filter : 'upcoming';

    // Parse search query
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    // Find all clubs where the user is a member
    const memberships = await Member.find({ user: userId });

    // If user is not a member of any clubs, return empty paginated response
    if (!memberships || memberships.length === 0) {
      return res.status(200).json({
        events: [],
        page,
        limit,
        total: 0,
        hasMore: false,
      });
    }

    // Extract club IDs from memberships
    const clubIds = memberships.map((membership) => membership.club);

    // Build base query
    const filterQuery = {
      club: { $in: clubIds },
    };

    // Apply time-based filter
    const now = new Date();
    let sortOrder = { startTime: 1 };
    if (filter === 'upcoming') {
      filterQuery.startTime = { $gte: now };
      sortOrder = { startTime: 1 };
    } else if (filter === 'past') {
      filterQuery.startTime = { $lt: now };
      sortOrder = { startTime: -1 };
    }

    // Apply search query (escaped to prevent ReDoS / regex injection)
    if (q.length > 0) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filterQuery.$or = [
        { name: regex },
        { description: regex },
        { location: regex },
      ];
    }

    const skip = (page - 1) * limit;

    // Run count and find in parallel
    const [total, events] = await Promise.all([
      Event.countDocuments(filterQuery),
      Event.find(filterQuery)
        .populate('club', 'clubName')
        .populate('createdBy', 'username')
        .sort(sortOrder)
        .skip(skip)
        .limit(limit),
    ]);

    const hasMore = page * limit < total;

    res.status(200).json({
      events,
      page,
      limit,
      total,
      hasMore,
    });
  } catch (err) {
    console.error('Error fetching my club events:', err.message);
    res.status(500).json({
      message: 'Server Error',
      error: err.message
    });
  }
}

export async function getEventById(req, res) {
  try {
    const event = await Event.findById(req.params.eventId)
      .populate('club', 'clubName')
      .populate('createdBy', 'username name')
      // v1 cap: populate is not capped here, frontend should slice. Consider
      // an aggregation-based slice in v2 if attendee lists grow large.
      .populate('attendees', '_id username name profilePicture');

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const userId = req.user._id;
    const isCreator =
      event.createdBy &&
      (event.createdBy._id
        ? event.createdBy._id.equals(userId)
        : event.createdBy.equals(userId));
    const isJoined = (event.attendees || []).some((a) => {
      const id = a._id || a;
      return id.equals ? id.equals(userId) : String(id) === String(userId);
    });

    // v1 cap: only return first 20 attendees in detail view
    const cappedAttendees = (event.attendees || []).slice(0, 20);

    const obj = event.toObject();
    obj.attendees = cappedAttendees;
    obj.attendeeCount = event.attendeeCount || 0;
    obj.maxAttendees = event.maxAttendees ?? null;
    obj.scope = event.scope || 'club';
    obj.joinPolicy = event.joinPolicy || 'instant';
    obj.isJoined = isJoined;
    obj.isCreator = !!isCreator;

    res.status(200).json(obj);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
}

/**
 * GET /api/event/global
 * Paginated feed of public global events.
 */
export async function getGlobalEvents(req, res) {
  try {
    const userId = req.user._id;

    let page = parseInt(req.query.page, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 50) limit = 50;

    const allowedFilters = ['upcoming', 'past', 'all'];
    const filter = allowedFilters.includes(req.query.filter)
      ? req.query.filter
      : 'upcoming';

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const filterQuery = { scope: 'global' };

    const now = new Date();
    let sortOrder = { startTime: 1 };
    if (filter === 'upcoming') {
      filterQuery.startTime = { $gte: now };
      sortOrder = { startTime: 1 };
    } else if (filter === 'past') {
      filterQuery.startTime = { $lt: now };
      sortOrder = { startTime: -1 };
    }

    if (q.length > 0) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filterQuery.$or = [
        { name: regex },
        { description: regex },
        { location: regex },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, events] = await Promise.all([
      Event.countDocuments(filterQuery),
      Event.find(filterQuery)
        .populate('createdBy', 'username name')
        .sort(sortOrder)
        .skip(skip)
        .limit(limit),
    ]);

    const shaped = events.map((e) => {
      const isCreator =
        e.createdBy &&
        (e.createdBy._id
          ? e.createdBy._id.equals(userId)
          : e.createdBy.equals(userId));
      const isJoined = (e.attendees || []).some((a) =>
        a.equals ? a.equals(userId) : String(a) === String(userId)
      );
      return {
        _id: e._id,
        name: e.name,
        description: e.description,
        startTime: e.startTime,
        endTime: e.endTime,
        location: e.location,
        imageUrl: e.imageUrl,
        eventType: e.eventType,
        scope: e.scope,
        createdBy: e.createdBy
          ? {
              _id: e.createdBy._id,
              username: e.createdBy.username,
              name: e.createdBy.name,
            }
          : null,
        attendeeCount: e.attendeeCount || 0,
        maxAttendees: e.maxAttendees ?? null,
        isJoined,
        isCreator: !!isCreator,
      };
    });

    const hasMore = page * limit < total;

    res.status(200).json({
      events: shaped,
      page,
      limit,
      total,
      hasMore,
    });
  } catch (err) {
    console.error('Error fetching global events:', err.message);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

/**
 * POST /api/event/:eventId/join
 */
export async function joinEvent(req, res) {
  try {
    const { eventId } = req.params;
    const userId = req.user._id;

    if (!eventId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid event ID format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (event.scope !== 'global') {
      return res
        .status(400)
        .json({ message: 'Club events use club membership, not join' });
    }

    if (event.startTime && new Date(event.startTime) < new Date()) {
      return res.status(400).json({ message: 'Event has already started' });
    }

    if (
      event.maxAttendees != null &&
      event.attendeeCount >= event.maxAttendees
    ) {
      return res.status(400).json({ message: 'Event is full' });
    }

    if (event.createdBy.equals(userId)) {
      return res.status(400).json({ message: 'Already joined' });
    }

    const updated = await Event.findOneAndUpdate(
      { _id: eventId, attendees: { $ne: userId } },
      {
        $addToSet: { attendees: userId },
        $inc: { attendeeCount: 1 },
      },
      { new: true }
    ).populate('createdBy', 'username name');

    if (!updated) {
      return res.status(400).json({ message: 'Already joined' });
    }

    // Notify the event creator (mirroring club join_request pattern)
    try {
      if (!updated.createdBy._id.equals(userId)) {
        const joinerName = getUserDisplayName(req.user);
        await Notification.createNotification({
          type: 'event_join',
          recipient: updated.createdBy._id,
          sender: userId,
          club: null, // global event - no club
          message: `${joinerName} joined your event ${updated.name}`,
          data: {
            eventId: updated._id,
            eventName: updated.name,
            joinerUserId: userId,
            joinerName,
          },
        });
      }
    } catch (notifyErr) {
      console.error('Failed to create event_join notification:', notifyErr.message);
      // Do not fail the join on notification error
    }

    return res.status(200).json({
      _id: updated._id,
      attendeeCount: updated.attendeeCount,
      maxAttendees: updated.maxAttendees ?? null,
      scope: updated.scope,
      isJoined: true,
      isCreator: false,
    });
  } catch (err) {
    console.error('Error joining event:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

/**
 * POST /api/event/:eventId/leave
 */
export async function leaveEvent(req, res) {
  try {
    const { eventId } = req.params;
    const userId = req.user._id;

    if (!eventId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid event ID format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (event.createdBy.equals(userId)) {
      return res.status(400).json({
        message:
          'Creators cannot leave their own event; delete it instead',
      });
    }

    const updated = await Event.findOneAndUpdate(
      { _id: eventId, attendees: userId },
      {
        $pull: { attendees: userId },
        $inc: { attendeeCount: -1 },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(400).json({ message: 'Not joined' });
    }

    return res.status(200).json({
      _id: updated._id,
      attendeeCount: updated.attendeeCount,
      maxAttendees: updated.maxAttendees ?? null,
      scope: updated.scope,
      isJoined: false,
      isCreator: false,
    });
  } catch (err) {
    console.error('Error leaving event:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
  }
}

/**
 * DELETE /api/event/:eventId
 */
export async function deleteEvent(req, res) {
  try {
    const { eventId } = req.params;
    const userId = req.user._id;

    if (!eventId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid event ID format' });
    }

    const event = await Event.findById(eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (!event.createdBy.equals(userId)) {
      return res
        .status(403)
        .json({ message: 'Only the event creator can delete this event' });
    }

    // Best effort delete of any associated cloudinary image
    if (event.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(event.imagePublicId);
      } catch (e) {
        console.warn('Failed to delete event image from cloudinary:', e.message);
      }
    }

    await Event.deleteOne({ _id: eventId });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error deleting event:', err.message);
    return res.status(500).json({ message: 'Server Error', error: err.message });
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
