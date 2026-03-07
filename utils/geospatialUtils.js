/**
 * Geospatial utilities for MongoDB queries and distance calculations
 *
 * This module provides utilities for:
 * - Converting between different coordinate formats
 * - Building MongoDB geospatial queries
 * - Distance calculations
 */

/**
 * Convert latitude/longitude coordinates to GeoJSON Point format
 * @param {number} latitude - Latitude coordinate (-90 to 90)
 * @param {number} longitude - Longitude coordinate (-180 to 180)
 * @returns {Object} GeoJSON Point object
 */
export function toGeoJSONPoint(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('Latitude and longitude must be numbers');
  }

  if (latitude < -90 || latitude > 90) {
    throw new Error('Latitude must be between -90 and 90');
  }

  if (longitude < -180 || longitude > 180) {
    throw new Error('Longitude must be between -180 and 180');
  }

  return {
    type: 'Point',
    coordinates: [longitude, latitude] // GeoJSON uses [lng, lat] order
  };
}

/**
 * Convert GeoJSON Point to latitude/longitude object
 * @param {Object} geoJsonPoint - GeoJSON Point object
 * @returns {Object} Object with latitude and longitude properties
 */
export function fromGeoJSONPoint(geoJsonPoint) {
  if (!geoJsonPoint || geoJsonPoint.type !== 'Point') {
    throw new Error('Invalid GeoJSON Point object');
  }

  if (!Array.isArray(geoJsonPoint.coordinates) || geoJsonPoint.coordinates.length !== 2) {
    throw new Error('GeoJSON Point must have coordinates array with 2 elements');
  }

  const [longitude, latitude] = geoJsonPoint.coordinates;
  return { latitude, longitude };
}

/**
 * Build MongoDB $near query for finding nearby documents
 * @param {number} latitude - Center latitude
 * @param {number} longitude - Center longitude
 * @param {number} maxDistanceMeters - Maximum distance in meters
 * @returns {Object} MongoDB $near query object
 */
export function buildNearQuery(latitude, longitude, maxDistanceMeters) {
  const centerPoint = toGeoJSONPoint(latitude, longitude);

  return {
    $near: {
      $geometry: centerPoint,
      $maxDistance: maxDistanceMeters
    }
  };
}

/**
 * Build MongoDB $geoWithin query for finding documents within a radius
 * @param {number} latitude - Center latitude
 * @param {number} longitude - Center longitude
 * @param {number} radiusMeters - Radius in meters
 * @returns {Object} MongoDB $geoWithin query object
 */
export function buildGeoWithinQuery(latitude, longitude, radiusMeters) {
  const centerPoint = toGeoJSONPoint(latitude, longitude);

  return {
    $geoWithin: {
      $centerSphere: [
        centerPoint.coordinates,
        radiusMeters / 6378100 // Convert meters to radians (Earth radius in meters)
      ]
    }
  };
}

/**
 * Calculate distance between two points using Haversine formula
 * @param {number} lat1 - First point latitude
 * @param {number} lng1 - First point longitude
 * @param {number} lat2 - Second point latitude
 * @param {number} lng2 - Second point longitude
 * @returns {number} Distance in kilometers
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Convert degrees to radians
 * @param {number} degrees - Angle in degrees
 * @returns {number} Angle in radians
 */
function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Validate latitude coordinate
 * @param {number} latitude - Latitude to validate
 * @returns {boolean} True if valid
 */
export function isValidLatitude(latitude) {
  return typeof latitude === 'number' && latitude >= -90 && latitude <= 90;
}

/**
 * Validate longitude coordinate
 * @param {number} longitude - Longitude to validate
 * @returns {boolean} True if valid
 */
export function isValidLongitude(longitude) {
  return typeof longitude === 'number' && longitude >= -180 && longitude <= 180;
}

/**
 * Validate coordinate pair
 * @param {number} latitude - Latitude coordinate
 * @param {number} longitude - Longitude coordinate
 * @returns {boolean} True if both coordinates are valid
 */
export function isValidCoordinates(latitude, longitude) {
  return isValidLatitude(latitude) && isValidLongitude(longitude);
}

/**
 * Convert kilometers to meters
 * @param {number} kilometers - Distance in kilometers
 * @returns {number} Distance in meters
 */
export function kmToMeters(kilometers) {
  return kilometers * 1000;
}

/**
 * Convert meters to kilometers
 * @param {number} meters - Distance in meters
 * @returns {number} Distance in kilometers
 */
export function metersToKm(meters) {
  return meters / 1000;
}