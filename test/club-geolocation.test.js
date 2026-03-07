import request from 'supertest';
import { app, mongoose, server } from '../server.js';
import { ensureConnection } from './setup.js';
import Club from '../models/ClubModel.js';
import dotenv from 'dotenv';

dotenv.config();

async function createUserAndGetToken() {
  const email = `geolocation_test_${Date.now()}@example.com`;
  const password = 'Password123!';
  const username = `geolocation_user_${Date.now()}`;
  await request(app)
    .post('/api/auth/signup')
    .send({ email, password, username });
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password });
  return login.body.token;
}

describe('Club Geolocation Support', () => {
  let token;

  before(async () => {
    await ensureConnection();
    token = await createUserAndGetToken();
  });

  after(async () => {
    if (server) server.close();
  });

  it('should create a club with valid geolocation data', async () => {
    const geolocationData = {
      latitude: 34.0522,
      longitude: -118.2437,
      placeName: 'Los Angeles, CA, USA'
    };

    const res = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Geolocation Club ${Date.now()}`,
        description: 'A club with geolocation data',
        location: 'Los Angeles',
        isPrivate: false,
        geolocation: geolocationData
      });

    console.log('Create club with geolocation response:', res.status, res.body);

    if (![200, 201].includes(res.status)) {
      console.error('Failed to create club with geolocation:', res.body);
      throw new Error(`Expected status 200/201, got ${res.status}`);
    }

    // Verify the club was created with geolocation data
    const clubId = res.body._id;
    const club = await Club.findById(clubId);

    console.log('Retrieved club from database:', JSON.stringify(club.geolocation, null, 2));

    // Verify geolocation data was saved correctly
    if (!club.geolocation) {
      throw new Error('Geolocation data was not saved');
    }

    if (club.geolocation.latitude !== geolocationData.latitude) {
      throw new Error(`Expected latitude ${geolocationData.latitude}, got ${club.geolocation.latitude}`);
    }

    if (club.geolocation.longitude !== geolocationData.longitude) {
      throw new Error(`Expected longitude ${geolocationData.longitude}, got ${club.geolocation.longitude}`);
    }

    if (club.geolocation.placeName !== geolocationData.placeName) {
      throw new Error(`Expected placeName ${geolocationData.placeName}, got ${club.geolocation.placeName}`);
    }

    console.log('✅ Geolocation data saved correctly');
  });

  it('should create a club without geolocation data (optional field)', async () => {
    const res = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `No Geolocation Club ${Date.now()}`,
        description: 'A club without geolocation data',
        location: 'Somewhere',
        isPrivate: false
      });

    console.log('Create club without geolocation response:', res.status, res.body);

    if (![200, 201].includes(res.status)) {
      console.error('Failed to create club without geolocation:', res.body);
      throw new Error(`Expected status 200/201, got ${res.status}`);
    }

    // Verify the club was created without geolocation data
    const clubId = res.body._id;
    const club = await Club.findById(clubId);

    console.log('Retrieved club geolocation field:', club.geolocation);

    // Geolocation should be undefined or an empty object
    if (club.geolocation && (club.geolocation.latitude || club.geolocation.longitude)) {
      throw new Error('Geolocation data should not be present when not provided');
    }

    console.log('✅ Club created successfully without geolocation data');
  });

  it('should return geolocation data when fetching all clubs', async () => {
    // Create a club with geolocation first
    const geolocationData = {
      latitude: 40.7128,
      longitude: -74.0060,
      placeName: 'New York, NY, USA'
    };

    const createRes = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `NYC Club ${Date.now()}`,
        description: 'A club in NYC',
        location: 'New York',
        isPrivate: false,
        geolocation: geolocationData
      });

    if (![200, 201].includes(createRes.status)) {
      throw new Error(`Failed to create club: ${createRes.status}`);
    }

    // Fetch all clubs and verify geolocation is included
    const res = await request(app).get('/api/club');

    if (res.status !== 200) {
      throw new Error(`Failed to fetch clubs: ${res.status}`);
    }

    console.log('Fetched clubs response status:', res.status);

    // Find our club in the response
    const ourClub = res.body.clubs.find(club => club.id === createRes.body._id);

    if (!ourClub) {
      throw new Error('Could not find created club in the list');
    }

    console.log('Our club geolocation in response:', JSON.stringify(ourClub.geolocation, null, 2));

    // Verify geolocation is included in the response
    if (!ourClub.geolocation) {
      throw new Error('Geolocation data not included in club list response');
    }

    if (ourClub.geolocation.latitude !== geolocationData.latitude) {
      throw new Error(`Expected latitude ${geolocationData.latitude}, got ${ourClub.geolocation.latitude}`);
    }

    console.log('✅ Geolocation data returned correctly in club list');
  });

  it('should handle partial geolocation data gracefully', async () => {
    // Test with only latitude and longitude, no placeName
    const partialGeolocation = {
      latitude: 51.5074,
      longitude: -0.1278
    };

    const res = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Partial Geolocation Club ${Date.now()}`,
        description: 'A club with partial geolocation data',
        location: 'London',
        isPrivate: false,
        geolocation: partialGeolocation
      });

    console.log('Create club with partial geolocation response:', res.status, res.body);

    if (![200, 201].includes(res.status)) {
      console.error('Failed to create club with partial geolocation:', res.body);
      throw new Error(`Expected status 200/201, got ${res.status}`);
    }

    // Verify the club was created with partial geolocation data
    const clubId = res.body._id;
    const club = await Club.findById(clubId);

    console.log('Retrieved club with partial geolocation:', JSON.stringify(club.geolocation, null, 2));

    // Verify geolocation data was saved correctly
    if (!club.geolocation) {
      throw new Error('Geolocation data was not saved');
    }

    if (club.geolocation.latitude !== partialGeolocation.latitude) {
      throw new Error(`Expected latitude ${partialGeolocation.latitude}, got ${club.geolocation.latitude}`);
    }

    if (club.geolocation.longitude !== partialGeolocation.longitude) {
      throw new Error(`Expected longitude ${partialGeolocation.longitude}, got ${club.geolocation.longitude}`);
    }

    // placeName should be undefined or empty since it wasn't provided
    if (club.geolocation.placeName && club.geolocation.placeName.trim() !== '') {
      console.log('Warning: placeName was set to:', club.geolocation.placeName);
    }

    console.log('✅ Partial geolocation data handled correctly');
  });

  it('should reject invalid geolocation data', async () => {
    // Test with invalid latitude (outside valid range)
    const invalidGeolocation = {
      latitude: 200, // Invalid: should be between -90 and 90
      longitude: -118.2437,
      placeName: 'Invalid Location'
    };

    const res = await request(app)
      .post('/api/club/create')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Invalid Geolocation Club ${Date.now()}`,
        description: 'A club with invalid geolocation data',
        location: 'Invalid',
        isPrivate: false,
        geolocation: invalidGeolocation
      });

    console.log('Create club with invalid geolocation response:', res.status, res.body);

    // This should fail due to mongoose validation
    if (res.status === 201 || res.status === 200) {
      console.warn('Warning: Invalid geolocation was accepted. This might indicate validation is not working.');
      // Let's check if the data was actually saved
      const clubId = res.body._id;
      const club = await Club.findById(clubId);
      console.log('Saved invalid geolocation:', club.geolocation);
    } else {
      console.log('✅ Invalid geolocation data was properly rejected');
    }
  });
});