/**
 * CSV Service Usage Examples
 *
 * This file demonstrates how to use the CSVService utility for parsing and generating CSV files
 * for official members in the Motoclub Connect backend.
 */

import CSVService from './csvService.js';
import fs from 'fs';

/**
 * Example 1: Parse a CSV file from a multipart form upload
 */
async function exampleParseUploadedCSV(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No CSV file uploaded' });
    }

    // Parse the CSV buffer
    const { members, errors } = await CSVService.parseCSV(req.file.buffer);

    // Check for validation errors
    if (errors.length > 0) {
      return res.status(400).json({
        message: 'CSV validation failed',
        errors,
        validCount: members.length,
        errorCount: errors.length,
      });
    }

    // Check for duplicate official numbers
    const { clubId } = req.params;
    const officialNumbers = members.map((m) => m.officialNumber);
    const duplicates = await CSVService.checkDuplicates(clubId, officialNumbers);

    if (duplicates.length > 0) {
      return res.status(400).json({
        message: 'Duplicate official numbers found',
        duplicates,
      });
    }

    // Process valid members (save to database, etc.)
    // ...

    return res.status(200).json({
      message: 'CSV parsed successfully',
      members,
      count: members.length,
    });
  } catch (error) {
    console.error('Error processing CSV:', error);
    return res.status(500).json({
      message: 'Failed to process CSV',
      error: error.message,
    });
  }
}

/**
 * Example 2: Generate CSV from official members
 */
async function exampleGenerateCSV(req, res) {
  try {
    const { clubId } = req.params;

    // Fetch official members from database
    const OfficialMember = (await import('../models/OfficialMemberModel.js')).default;
    const members = await OfficialMember.find({ club: clubId })
      .populate('claimedBy', 'username email')
      .lean();

    // Generate CSV
    const csv = CSVService.generateCSV(members);

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=official-members-${clubId}.csv`);

    return res.send(csv);
  } catch (error) {
    console.error('Error generating CSV:', error);
    return res.status(500).json({
      message: 'Failed to generate CSV',
      error: error.message,
    });
  }
}

/**
 * Example 3: Validate CSV headers before processing
 */
async function exampleValidateCSVHeaders(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No CSV file uploaded' });
    }

    // Read first line to get headers
    const buffer = req.file.buffer;
    const firstLine = buffer.toString().split('\n')[0];
    const headers = firstLine.split(',').map((h) => h.trim().replace(/"/g, ''));

    // Validate headers
    const validation = CSVService.validateHeaders(headers);

    if (!validation.valid) {
      return res.status(400).json({
        message: 'Invalid CSV headers',
        errors: validation.errors,
      });
    }

    // Log missing optional columns
    if (validation.missingOptional && validation.missingOptional.length > 0) {
      console.log('Note: CSV is missing optional columns:', validation.missingOptional);
    }

    // Proceed to next middleware/route handler
    next();
  } catch (error) {
    console.error('Error validating CSV headers:', error);
    return res.status(500).json({
      message: 'Failed to validate CSV headers',
      error: error.message,
    });
  }
}

/**
 * Example 4: Comprehensive CSV upload workflow
 */
async function exampleComprehensiveCSVUpload(req, res) {
  try {
    const { clubId } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: 'No CSV file uploaded' });
    }

    // Step 1: Validate headers
    const firstLine = req.file.buffer.toString().split('\n')[0];
    const headers = firstLine.split(',').map((h) => h.trim().replace(/"/g, ''));
    const headerValidation = CSVService.validateHeaders(headers);

    if (!headerValidation.valid) {
      return res.status(400).json({
        message: 'Invalid CSV headers',
        errors: headerValidation.errors,
      });
    }

    // Step 2: Parse CSV
    const { members, errors: validationErrors } = await CSVService.parseCSV(req.file.buffer);

    // Step 3: Return validation errors if any
    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'CSV validation failed',
        errors: validationErrors,
        summary: {
          totalRows: members.length + validationErrors.length,
          validRows: members.length,
          invalidRows: validationErrors.length,
        },
      });
    }

    // Step 4: Check for duplicates
    const officialNumbers = members.map((m) => m.officialNumber);
    const duplicates = await CSVService.checkDuplicates(clubId, officialNumbers);

    if (duplicates.length > 0) {
      return res.status(400).json({
        message: 'Duplicate official numbers found',
        duplicates,
        suggestion: 'Please remove or update duplicate official numbers and try again.',
      });
    }

    // Step 5: Save to database (example)
    const OfficialMember = (await import('../models/OfficialMemberModel.js')).default;
    const savePromises = members.map((memberData) => {
      const { _rowNumber, ...memberFields } = memberData;
      return OfficialMember.create({
        ...memberFields,
        club: clubId,
        isActive: true,
      });
    });

    const savedMembers = await Promise.all(savePromises);

    return res.status(201).json({
      message: 'Official members imported successfully',
      summary: {
        totalImported: savedMembers.length,
        clubId,
      },
      members: savedMembers,
    });
  } catch (error) {
    console.error('Error importing official members:', error);
    return res.status(500).json({
      message: 'Failed to import official members',
      error: error.message,
    });
  }
}

/**
 * Example 5: CSV row validation standalone
 */
function exampleValidateRow() {
  const sampleRow = {
    officialNumber: 'MC-123',
    firstName: 'John',
    lastName: 'Doe',
    address: '123 Main St, City, State',
    plateNumber: 'ABC1234',
    description: 'Enthusiastic rider',
    photo: 'https://example.com/photo.jpg',
  };

  const validation = CSVService.validateRow(sampleRow);

  console.log('Valid:', validation.valid);
  console.log('Errors:', validation.errors);
  console.log('Data:', validation.data);
}

export {
  exampleParseUploadedCSV,
  exampleGenerateCSV,
  exampleValidateCSVHeaders,
  exampleComprehensiveCSVUpload,
  exampleValidateRow,
};
