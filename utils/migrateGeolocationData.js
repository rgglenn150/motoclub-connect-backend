/**
 * Migration script to populate geoPoint field from existing geolocation data
 * This ensures proper MongoDB geospatial indexing for all existing clubs
 */

import mongoose from 'mongoose';
import Club from '../models/ClubModel.js';
import { toGeoJSONPoint } from './geospatialUtils.js';

// MongoDB connection URI
const MONGO_URI = process.env.MONGO_LOCAL_URI || 'mongodb://localhost:27017/motoclub_dev';

/**
 * Connect to MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB for migration');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

/**
 * Migrate geolocation data to geoPoint format
 */
async function migrateGeolocationData() {
  try {
    console.log('🔍 Finding clubs with geolocation data but missing geoPoint...');

    // Find clubs with geolocation but no geoPoint
    const clubsToMigrate = await Club.find({
      $and: [
        { geolocation: { $exists: true, $ne: null } },
        { 'geolocation.latitude': { $exists: true, $ne: null } },
        { 'geolocation.longitude': { $exists: true, $ne: null } },
        {
          $or: [
            { geoPoint: { $exists: false } },
            { geoPoint: null }
          ]
        }
      ]
    });

    console.log(`📊 Found ${clubsToMigrate.length} clubs to migrate`);

    if (clubsToMigrate.length === 0) {
      console.log('✅ No clubs need migration');
      return { migrated: 0, errors: 0 };
    }

    let migrated = 0;
    let errors = 0;

    for (const club of clubsToMigrate) {
      try {
        const { latitude, longitude } = club.geolocation;

        // Validate coordinates
        if (typeof latitude !== 'number' || typeof longitude !== 'number') {
          console.warn(`⚠️  Skipping club ${club.clubName}: Invalid coordinate types`);
          errors++;
          continue;
        }

        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          console.warn(`⚠️  Skipping club ${club.clubName}: Invalid coordinate ranges`);
          errors++;
          continue;
        }

        // Create GeoJSON Point
        const geoPoint = toGeoJSONPoint(latitude, longitude);

        // Update the club with geoPoint
        await Club.updateOne(
          { _id: club._id },
          { $set: { geoPoint: geoPoint } }
        );

        console.log(`✅ Migrated club: ${club.clubName} (${latitude}, ${longitude})`);
        migrated++;

      } catch (error) {
        console.error(`❌ Error migrating club ${club.clubName}:`, error.message);
        errors++;
      }
    }

    return { migrated, errors };

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

/**
 * Verify migration results
 */
async function verifyMigration() {
  try {
    console.log('🔍 Verifying migration results...');

    const totalClubs = await Club.countDocuments({});
    const clubsWithGeolocation = await Club.countDocuments({
      geolocation: { $exists: true, $ne: null },
      'geolocation.latitude': { $exists: true, $ne: null },
      'geolocation.longitude': { $exists: true, $ne: null }
    });
    const clubsWithGeoPoint = await Club.countDocuments({
      geoPoint: { $exists: true, $ne: null }
    });

    console.log(`📊 Migration verification:`);
    console.log(`   Total clubs: ${totalClubs}`);
    console.log(`   Clubs with geolocation: ${clubsWithGeolocation}`);
    console.log(`   Clubs with geoPoint: ${clubsWithGeoPoint}`);

    if (clubsWithGeolocation === clubsWithGeoPoint) {
      console.log('✅ Migration verification passed!');
    } else {
      console.log('⚠️  Migration verification warning: Mismatch between geolocation and geoPoint counts');
    }

    return {
      totalClubs,
      clubsWithGeolocation,
      clubsWithGeoPoint
    };

  } catch (error) {
    console.error('❌ Verification failed:', error);
    throw error;
  }
}

/**
 * Main migration function
 */
async function runMigration() {
  try {
    console.log('🚀 Starting geolocation data migration...');

    await connectDB();

    const results = await migrateGeolocationData();
    const verification = await verifyMigration();

    console.log('✅ Migration completed successfully!');
    console.log(`📊 Results: ${results.migrated} migrated, ${results.errors} errors`);

    return results;

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run migration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration();
}

export { runMigration, migrateGeolocationData, verifyMigration };