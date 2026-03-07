import csvParser from 'csv-parser';
import { Readable } from 'stream';
import OfficialMember from '../models/OfficialMemberModel.js';

/**
 * CSV Service Utility
 * Handles parsing and generating CSV files for official members
 */
class CSVService {
  /**
   * Parse CSV file buffer and return array of official member data
   * @param {Buffer} buffer - CSV file buffer
   * @returns {Promise<Object>} Object with { members: [], errors: [] }
   */
  static async parseCSV(buffer) {
    return new Promise((resolve, reject) => {
      const members = [];
      const errors = [];
      let rowIndex = 0;

      // Create a readable stream from the buffer
      const stream = Readable.from(buffer);

      stream
        .pipe(csvParser())
        .on('data', (row) => {
          rowIndex++;

          // Validate the row
          const validation = this.validateRow(row);

          if (validation.valid) {
            members.push({
              ...validation.data,
              _rowNumber: rowIndex, // Track row number for error reporting
            });
          } else {
            errors.push({
              row: rowIndex,
              errors: validation.errors,
              data: row,
            });
          }
        })
        .on('end', () => {
          resolve({ members, errors });
        })
        .on('error', (error) => {
          reject(new Error(`Failed to parse CSV: ${error.message}`));
        });
    });
  }

  /**
   * Validate a single CSV row
   * @param {Object} row - CSV row data
   * @returns {Object} Object with { valid: boolean, errors: [], data: {} }
   */
  static validateRow(row) {
    const errors = [];
    const data = {};

    // Trim all values
    const trimmedRow = {};
    for (const [key, value] of Object.entries(row)) {
      trimmedRow[key] = typeof value === 'string' ? value.trim() : value;
    }

    // Validate optional field: officialNumber (will be auto-generated if not provided)
    if (trimmedRow.officialNumber && trimmedRow.officialNumber !== '') {
      // Validate official number format: 1-20 alphanumeric characters and hyphens
      const officialNumberRegex = /^[A-Za-z0-9-]{1,20}$/;
      if (!officialNumberRegex.test(trimmedRow.officialNumber)) {
        errors.push('Official number must be 1-20 alphanumeric characters (letters, numbers, hyphens only)');
      } else {
        data.officialNumber = trimmedRow.officialNumber;
      }
    } else {
      // Mark as needing auto-generation
      data.officialNumber = null;
    }

    // Validate required field: firstName
    if (!trimmedRow.firstName || trimmedRow.firstName === '') {
      errors.push('First name is required');
    } else if (trimmedRow.firstName.length > 50) {
      errors.push('First name must not exceed 50 characters');
    } else {
      data.firstName = trimmedRow.firstName;
    }

    // Validate optional field: lastName
    if (trimmedRow.lastName && trimmedRow.lastName !== '') {
      if (trimmedRow.lastName.length > 50) {
        errors.push('Last name must not exceed 50 characters');
      } else {
        data.lastName = trimmedRow.lastName;
      }
    } else {
      data.lastName = '';
    }

    // Validate optional field: address (max 200 characters)
    if (trimmedRow.address !== undefined && trimmedRow.address !== '') {
      if (trimmedRow.address.length > 200) {
        errors.push('Address must not exceed 200 characters');
      } else {
        data.address = trimmedRow.address;
      }
    } else {
      data.address = '';
    }

    // Validate optional field: plateNumber (max 20 characters)
    if (trimmedRow.plateNumber !== undefined && trimmedRow.plateNumber !== '') {
      if (trimmedRow.plateNumber.length > 20) {
        errors.push('Plate number must not exceed 20 characters');
      } else {
        data.plateNumber = trimmedRow.plateNumber;
      }
    } else {
      data.plateNumber = '';
    }

    // Validate optional field: description (max 500 characters)
    if (trimmedRow.description !== undefined && trimmedRow.description !== '') {
      if (trimmedRow.description.length > 500) {
        errors.push('Description must not exceed 500 characters');
      } else {
        data.description = trimmedRow.description;
      }
    } else {
      data.description = '';
    }

    // Handle optional field: photo (URL or filename)
    if (trimmedRow.photo !== undefined && trimmedRow.photo !== '') {
      data.photo = trimmedRow.photo;
    } else {
      data.photo = '';
    }

    return {
      valid: errors.length === 0,
      errors,
      data,
    };
  }

  /**
   * Generate CSV from official members array
   * @param {Array} members - Array of official member documents
   * @returns {string} CSV string
   */
  static generateCSV(members) {
    if (!Array.isArray(members) || members.length === 0) {
      return 'officialNumber,firstName,lastName,address,plateNumber,description,photoUrl,claimedBy,claimedAt,isActive\n';
    }

    // CSV headers
    const headers = [
      'officialNumber',
      'firstName',
      'lastName',
      'address',
      'plateNumber',
      'description',
      'photoUrl',
      'claimedBy',
      'claimedAt',
      'isActive',
    ];

    // Build CSV rows
    const csvRows = members.map((member) => {
      const row = {
        officialNumber: this.escapeCSVField(member.officialNumber || ''),
        firstName: this.escapeCSVField(member.firstName || ''),
        lastName: this.escapeCSVField(member.lastName || ''),
        address: this.escapeCSVField(member.address || ''),
        plateNumber: this.escapeCSVField(member.plateNumber || ''),
        description: this.escapeCSVField(member.description || ''),
        photoUrl: this.escapeCSVField(member.photoUrl || ''),
        claimedBy: this.escapeCSVField(member.claimedBy ? member.claimedBy.toString() : ''),
        claimedAt: this.escapeCSVField(member.claimedAt ? new Date(member.claimedAt).toISOString() : ''),
        isActive: this.escapeCSVField(member.isActive !== undefined ? member.isActive.toString() : 'true'),
      };

      return Object.values(row).join(',');
    });

    // Combine headers and rows
    return [headers.join(','), ...csvRows].join('\n');
  }

  /**
   * Escape CSV field by wrapping in quotes if necessary
   * @param {string} field - Field value to escape
   * @returns {string} Escaped field
   */
  static escapeCSVField(field) {
    if (field === null || field === undefined) {
      return '';
    }

    const stringValue = String(field);

    // If field contains comma, quote, or newline, wrap in quotes and escape quotes
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }

    return stringValue;
  }

  /**
   * Check for duplicate official numbers in bulk
   * @param {string} clubId - Club ID
   * @param {Array<string>} officialNumbers - Array of official numbers to check
   * @returns {Promise<Array<string>>} Array of duplicate official numbers
   */
  static async checkDuplicates(clubId, officialNumbers) {
    try {
      if (!Array.isArray(officialNumbers) || officialNumbers.length === 0) {
        return [];
      }

      // Query for existing official numbers in this club
      const existingMembers = await OfficialMember.find(
        {
          club: clubId,
          officialNumber: { $in: officialNumbers },
        },
        { officialNumber: 1, _id: 0 }
      ).lean();

      // Extract the duplicate numbers
      const duplicateNumbers = existingMembers.map((member) => member.officialNumber);

      return duplicateNumbers;
    } catch (error) {
      console.error('Error checking for duplicate official numbers:', error);
      throw new Error(`Failed to check for duplicates: ${error.message}`);
    }
  }

  /**
   * Validate CSV headers to ensure required columns are present
   * @param {Array<string>} headers - Array of CSV headers
   * @returns {Object} Object with { valid: boolean, errors: [] }
   */
  static validateHeaders(headers) {
    const errors = [];
    // Only firstName is required; officialNumber and lastName are optional
    const requiredHeaders = ['firstName'];

    if (!Array.isArray(headers)) {
      return {
        valid: false,
        errors: ['Invalid CSV format: headers not found'],
      };
    }

    // Check for required headers (case-insensitive)
    const normalizedHeaders = headers.map((h) => h.toLowerCase().trim());

    for (const required of requiredHeaders) {
      if (!normalizedHeaders.includes(required.toLowerCase())) {
        errors.push(`Missing required column: ${required}`);
      }
    }

    // Check for optional headers
    const optionalHeaders = [
      'officialNumber',
      'lastName',
      'address',
      'plateNumber',
      'description',
      'photo',
      'photoUrl',
    ];

    const missingOptional = optionalHeaders.filter(
      (h) => !normalizedHeaders.includes(h.toLowerCase())
    );

    return {
      valid: errors.length === 0,
      errors,
      missingOptional,
    };
  }
}

export default CSVService;
