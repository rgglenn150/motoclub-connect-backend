import Event from '../models/EventModel.js';
import { validationResult } from 'express-validator';

export async function createEvent(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, description, startTime, endTime, location, eventType, club } =
    req.body;
  console.log('Creating event with data:', req.body);
  try {
    const newEvent = new Event({
      name,
      description,
      startTime,
      endTime,
      location,
      eventType,
      club,
      createdBy: req.user._id,
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
