import OfficialMember from '../models/OfficialMemberModel.js';
import ClaimRequest from '../models/ClaimRequestModel.js';
import Club from '../models/ClubModel.js';
import Member from '../models/MemberModel.js';
import User from '../models/UserModel.js';
import CSVService from '../utils/csvService.js';

/**
 * Official Member Controller
 * Handles all CRUD operations, CSV import/export, search, claims, and ID card generation
 * for official club members
 */

// ==================== HELPER FUNCTIONS ====================

/**
 * Verify if user is admin of the club
 * @param {string} clubId - Club ID
 * @param {string} userId - User ID
 * @returns {Object} - { isAdmin: boolean, error?: string, member?: Object }
 */
async function verifyClubAdmin(clubId, userId) {
  try {
    const member = await Member.findOne({ club: clubId, user: userId });

    if (!member) {
      return { isAdmin: false, error: 'User is not a member of this club' };
    }

    if (!member.roles.includes('admin')) {
      return { isAdmin: false, error: 'User does not have admin privileges' };
    }

    return { isAdmin: true, member };
  } catch (error) {
    return { isAdmin: false, error: 'Database error verifying admin status' };
  }
}

/**
 * Verify if user is member of the club
 * @param {string} clubId - Club ID
 * @param {string} userId - User ID
 * @returns {Object} - { isMember: boolean, error?: string, member?: Object }
 */
async function verifyClubMember(clubId, userId) {
  try {
    const member = await Member.findOne({ club: clubId, user: userId });

    if (!member) {
      return { isMember: false, error: 'User is not a member of this club' };
    }

    return { isMember: true, member };
  } catch (error) {
    return { isMember: false, error: 'Database error verifying membership' };
  }
}

/**
 * Check if user can view official members based on visibility setting
 * @param {Object} club - Club document
 * @param {Object} userStatus - User's membership status
 * @returns {boolean} - Whether user can view official members
 */
function checkVisibilityPermission(club, userStatus) {
  const visibility = club.officialMembersVisibility || 'members';

  switch (visibility) {
    case 'public':
      return true;
    case 'members':
      return userStatus.isMember;
    case 'admins':
      return userStatus.isAdmin;
    default:
      return false;
  }
}

// ==================== CRUD FUNCTIONS ====================

/**
 * POST /api/official-members/:clubId/members
 * Create a new official member (admin only)
 */
async function createOfficialMember(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin
    const adminCheck = await verifyClubAdmin(clubId, userId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Validate required fields - only firstName is required
    const { officialNumber, firstName, lastName, address, plateNumber, description, metadata, photoUrl } = req.body;

    const validationErrors = [];

    if (!firstName || typeof firstName !== 'string' || firstName.trim().length === 0) {
      validationErrors.push({ field: 'firstName', message: 'First name is required' });
    }

    // Validate officialNumber format if provided
    if (officialNumber && typeof officialNumber === 'string' && officialNumber.trim().length > 0) {
      if (officialNumber.trim().length > 20) {
        validationErrors.push({ field: 'officialNumber', message: 'Official number must not exceed 20 characters' });
      }
    }

    // Validate lastName if provided
    if (lastName && typeof lastName === 'string' && lastName.trim().length > 50) {
      validationErrors.push({ field: 'lastName', message: 'Last name must not exceed 50 characters' });
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'Validation errors',
        errors: validationErrors,
      });
    }

    // Determine official number - auto-generate if not provided
    let finalOfficialNumber;
    if (officialNumber && typeof officialNumber === 'string' && officialNumber.trim().length > 0) {
      finalOfficialNumber = officialNumber.trim();

      // Check official number availability
      const isAvailable = await OfficialMember.isOfficialNumberAvailable(clubId, finalOfficialNumber);
      if (!isAvailable) {
        return res.status(400).json({ message: 'This official number is already taken' });
      }
    } else {
      // Auto-generate official number
      finalOfficialNumber = String(await getNextOfficialNumber(clubId));
    }

    // Create official member
    const officialMember = new OfficialMember({
      club: clubId,
      officialNumber: finalOfficialNumber,
      firstName: firstName.trim(),
      lastName: lastName?.trim() || '',
      address: address?.trim() || '',
      plateNumber: plateNumber?.trim() || '',
      description: description?.trim() || '',
      metadata: metadata || {},
      photoUrl: photoUrl || null,
    });

    await officialMember.save();

    // Add to club's officialMembers array
    club.officialMembers.push(officialMember._id);
    await club.save();

    // Populate references for response
    await officialMember.populate('club', 'clubName logoUrl');

    return res.status(201).json({
      message: 'Official member created successfully',
      officialMember,
      autoGeneratedOfficialNumber: !officialNumber || officialNumber.trim().length === 0,
    });
  } catch (error) {
    console.error('Error creating official member:', error);

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({ message: 'This official number already exists' });
    }

    return res.status(500).json({
      message: 'Server error creating official member',
      error: error?.message || error,
    });
  }
}

/**
 * GET /api/official-members/:clubId/members
 * Get all official members with pagination
 */
async function getOfficialMembers(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Check user's membership status
    const memberCheck = await verifyClubMember(clubId, userId);
    const adminCheck = await verifyClubAdmin(clubId, userId);

    const userStatus = {
      isMember: memberCheck.isMember,
      isAdmin: adminCheck.isAdmin,
    };

    // Check visibility permission
    if (!checkVisibilityPermission(club, userStatus)) {
      return res.status(403).json({ message: 'You do not have permission to view official members' });
    }

    // Get total count
    const total = await OfficialMember.countDocuments({ club: clubId });

    // Get official members with pagination
    const officialMembers = await OfficialMember.find({ club: clubId })
      .populate('club', 'clubName logoUrl')
      .populate('claimedBy', 'username email firstName lastName profilePhoto')
      .sort({ _id: 1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      officialMembers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error getting official members:', error);
    return res.status(500).json({
      message: 'Server error getting official members',
      error: error?.message || error,
    });
  }
}

/**
 * GET /api/official-members/:clubId/members/:memberId
 * Get a single official member by ID
 */
async function getOfficialMemberById(req, res) {
  try {
    const { clubId, memberId } = req.params;
    const userId = req.user._id;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !memberId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Check user's membership status
    const memberCheck = await verifyClubMember(clubId, userId);
    const adminCheck = await verifyClubAdmin(clubId, userId);

    const userStatus = {
      isMember: memberCheck.isMember,
      isAdmin: adminCheck.isAdmin,
    };

    // Check visibility permission
    if (!checkVisibilityPermission(club, userStatus)) {
      return res.status(403).json({ message: 'You do not have permission to view official members' });
    }

    // Get official member
    const officialMember = await OfficialMember.findOne({
      _id: memberId,
      club: clubId,
    })
      .populate('club', 'clubName logoUrl')
      .populate('claimedBy', 'username email firstName lastName profilePhoto');

    if (!officialMember) {
      return res.status(404).json({ message: 'Official member not found' });
    }

    return res.status(200).json({ officialMember });
  } catch (error) {
    console.error('Error getting official member:', error);
    return res.status(500).json({
      message: 'Server error getting official member',
      error: error?.message || error,
    });
  }
}

/**
 * PUT /api/official-members/:clubId/members/:memberId
 * Update an official member (admin only)
 */
async function updateOfficialMember(req, res) {
  try {
    const { clubId, memberId } = req.params;
    const userId = req.user._id;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !memberId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin
    const adminCheck = await verifyClubAdmin(clubId, userId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Find official member
    const officialMember = await OfficialMember.findOne({
      _id: memberId,
      club: clubId,
    });

    if (!officialMember) {
      return res.status(404).json({ message: 'Official member not found' });
    }

    // Validate update data
    const { officialNumber, firstName, lastName, address, plateNumber, description, metadata, photoUrl, isActive } = req.body;

    const validationErrors = [];

    if (firstName !== undefined && (typeof firstName !== 'string' || firstName.trim().length === 0)) {
      validationErrors.push({ field: 'firstName', message: 'First name cannot be empty' });
    }

    // lastName is optional, but validate max length if provided
    if (lastName !== undefined && typeof lastName === 'string' && lastName.trim().length > 50) {
      validationErrors.push({ field: 'lastName', message: 'Last name must not exceed 50 characters' });
    }

    if (officialNumber !== undefined) {
      if (typeof officialNumber !== 'string' || officialNumber.trim().length < 3) {
        validationErrors.push({ field: 'officialNumber', message: 'Official number must be at least 3 characters' });
      } else if (officialNumber.trim() !== officialMember.officialNumber) {
        // Check if new official number is available
        const isAvailable = await OfficialMember.isOfficialNumberAvailable(clubId, officialNumber.trim(), memberId);
        if (!isAvailable) {
          validationErrors.push({ field: 'officialNumber', message: 'This official number is already taken' });
        }
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        message: 'Validation errors',
        errors: validationErrors,
      });
    }

    // Update fields
    if (officialNumber !== undefined) officialMember.officialNumber = officialNumber.trim();
    if (firstName !== undefined) officialMember.firstName = firstName.trim();
    if (lastName !== undefined) officialMember.lastName = lastName.trim();
    if (address !== undefined) officialMember.address = address.trim();
    if (plateNumber !== undefined) officialMember.plateNumber = plateNumber.trim();
    if (description !== undefined) officialMember.description = description.trim();
    if (metadata !== undefined) officialMember.metadata = metadata;
    if (photoUrl !== undefined) officialMember.photoUrl = photoUrl;
    if (isActive !== undefined) officialMember.isActive = isActive;

    await officialMember.save();

    // Populate references for response
    await officialMember.populate('club', 'clubName logoUrl');
    await officialMember.populate('claimedBy', 'username email firstName lastName profilePhoto');

    return res.status(200).json({
      message: 'Official member updated successfully',
      officialMember,
    });
  } catch (error) {
    console.error('Error updating official member:', error);
    return res.status(500).json({
      message: 'Server error updating official member',
      error: error?.message || error,
    });
  }
}

/**
 * DELETE /api/official-members/:clubId/members/:memberId
 * Delete an official member (admin only)
 */
async function deleteOfficialMember(req, res) {
  try {
    const { clubId, memberId } = req.params;
    const userId = req.user._id;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !memberId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin
    const adminCheck = await verifyClubAdmin(clubId, userId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Find official member
    const officialMember = await OfficialMember.findOne({
      _id: memberId,
      club: clubId,
    });

    if (!officialMember) {
      return res.status(404).json({ message: 'Official member not found' });
    }

    // Delete any pending claim requests for this member
    await ClaimRequest.deleteMany({ officialMember: memberId });

    // Remove from club's officialMembers array
    club.officialMembers = club.officialMembers.filter(id => id.toString() !== memberId);
    await club.save();

    // Delete the official member
    await OfficialMember.findByIdAndDelete(memberId);

    return res.status(200).json({
      message: 'Official member deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting official member:', error);
    return res.status(500).json({
      message: 'Server error deleting official member',
      error: error?.message || error,
    });
  }
}

// ==================== CSV FUNCTIONS ====================

/**
 * Get the next available official number for a club
 * @param {string} clubId - Club ID
 * @returns {Promise<number>} Next available number
 */
async function getNextOfficialNumber(clubId) {
  // Find the highest numeric official number for this club
  const members = await OfficialMember.find({ club: clubId })
    .select('officialNumber')
    .lean();

  if (members.length === 0) {
    return 1;
  }

  // Extract numeric values from official numbers
  let maxNumber = 0;
  for (const member of members) {
    // Try to parse as integer (handles "001", "1", "42", etc.)
    const numericValue = parseInt(member.officialNumber, 10);
    if (!isNaN(numericValue) && numericValue > maxNumber) {
      maxNumber = numericValue;
    }
  }

  return maxNumber + 1;
}

/**
 * POST /api/official-members/:clubId/import
 * Import official members from CSV (admin only)
 */
async function importOfficialMembersFromCSV(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin
    const adminCheck = await verifyClubAdmin(clubId, userId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ message: 'CSV file is required' });
    }

    // Parse CSV using CSVService
    const parseResult = await CSVService.parseCSV(req.file.buffer);

    // Check for parsing errors
    if (parseResult.errors && parseResult.errors.length > 0) {
      console.log('CSV parsing errors:', parseResult.errors);
    }

    const csvData = parseResult.members || [];
    const parseErrors = (parseResult.errors || []).map(err => ({
      row: err.row,
      error: err.errors ? err.errors.join(', ') : 'Unknown parsing error',
    }));

    const importResults = {
      successful: 0,
      failed: parseErrors.length,
      duplicates: 0,
      autoGenerated: 0,
      errors: [...parseErrors],
    };

    // Get the starting point for auto-generated official numbers (from existing DB records)
    let highestNumber = await getNextOfficialNumber(clubId) - 1; // -1 because getNextOfficialNumber returns max+1

    // Track official numbers used in this import to avoid duplicates within the batch
    const usedOfficialNumbers = new Set();

    // Process each row - following CSV order for auto-generation
    for (const row of csvData) {
      try {
        // Validate required field: firstName only
        if (!row.firstName) {
          importResults.failed++;
          importResults.errors.push({
            row,
            error: 'Missing required field: firstName',
          });
          continue;
        }

        let officialNumber = row.officialNumber;

        if (officialNumber) {
          // Use provided official number
          officialNumber = officialNumber.trim();

          // Update highest number tracker if this provided number is higher
          const numericValue = parseInt(officialNumber, 10);
          if (!isNaN(numericValue) && numericValue > highestNumber) {
            highestNumber = numericValue;
          }
        } else {
          // Auto-generate: use next number after the highest seen so far
          highestNumber++;

          // Skip numbers already used in this batch
          while (usedOfficialNumbers.has(String(highestNumber))) {
            highestNumber++;
          }

          officialNumber = String(highestNumber);
          importResults.autoGenerated++;
        }

        // Check for duplicate official number in database
        const isAvailable = await OfficialMember.isOfficialNumberAvailable(clubId, officialNumber);
        if (!isAvailable) {
          importResults.duplicates++;
          importResults.errors.push({
            row,
            error: `Official number '${officialNumber}' already exists in the club`,
          });
          continue;
        }

        // Check for duplicate within this import batch
        if (usedOfficialNumbers.has(officialNumber)) {
          importResults.duplicates++;
          importResults.errors.push({
            row,
            error: `Duplicate official number '${officialNumber}' within CSV file`,
          });
          continue;
        }

        // Mark this official number as used
        usedOfficialNumbers.add(officialNumber);

        // Create official member
        const officialMember = new OfficialMember({
          club: clubId,
          officialNumber: officialNumber,
          firstName: row.firstName.trim(),
          lastName: row.lastName?.trim() || '',
          address: row.address?.trim() || '',
          plateNumber: row.plateNumber?.trim() || '',
          description: row.description?.trim() || '',
          metadata: row.metadata || {},
        });

        await officialMember.save();

        // Add to club's officialMembers array
        club.officialMembers.push(officialMember._id);

        importResults.successful++;
      } catch (error) {
        importResults.failed++;
        importResults.errors.push({
          row,
          error: error.message,
        });
      }
    }

    // Save club with new members
    await club.save();

    return res.status(200).json({
      message: 'CSV import completed',
      results: importResults,
    });
  } catch (error) {
    console.error('Error importing official members from CSV:', error);
    return res.status(500).json({
      message: 'Server error importing CSV',
      error: error?.message || error,
    });
  }
}

/**
 * GET /api/official-members/:clubId/export
 * Export official members to CSV (admin only)
 */
async function exportOfficialMembersToCSV(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin
    const adminCheck = await verifyClubAdmin(clubId, userId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Fetch all official members
    const officialMembers = await OfficialMember.find({ club: clubId })
      .populate('claimedBy', 'username email')
      .lean();

    // Generate CSV (placeholder - requires CSVService)
    // TODO: Implement CSVService.generateCSV()
    const csvContent = 'officialNumber,firstName,lastName,address,plateNumber,description\n';

    // Set CSV headers
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="official-members-${clubId}.csv"`);

    return res.send(csvContent);
  } catch (error) {
    console.error('Error exporting official members to CSV:', error);
    return res.status(500).json({
      message: 'Server error exporting CSV',
      error: error?.message || error,
    });
  }
}

// ==================== SEARCH/FILTER FUNCTIONS ====================

/**
 * GET /api/official-members/:clubId/search
 * Search official members by officialNumber, firstName, lastName, plateNumber
 */
async function searchOfficialMembers(req, res) {
  try {
    const { clubId } = req.params;
    const { q } = req.query;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Check search query
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Check user's membership status
    const memberCheck = await verifyClubMember(clubId, userId);
    const adminCheck = await verifyClubAdmin(clubId, userId);

    const userStatus = {
      isMember: memberCheck.isMember,
      isAdmin: adminCheck.isAdmin,
    };

    // Check visibility permission
    if (!checkVisibilityPermission(club, userStatus)) {
      return res.status(403).json({ message: 'You do not have permission to search official members' });
    }

    // Build search query
    const searchRegex = new RegExp(q.trim(), 'i');
    const searchQuery = {
      club: clubId,
      $or: [
        { officialNumber: searchRegex },
        { firstName: searchRegex },
        { lastName: searchRegex },
        { plateNumber: searchRegex },
      ],
    };

    // Get total count
    const total = await OfficialMember.countDocuments(searchQuery);

    // Search official members
    const officialMembers = await OfficialMember.find(searchQuery)
      .populate('club', 'clubName logoUrl')
      .populate('claimedBy', 'username email firstName lastName profilePhoto')
      .sort({ _id: 1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      officialMembers,
      searchQuery: q,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error searching official members:', error);
    return res.status(500).json({
      message: 'Server error searching official members',
      error: error?.message || error,
    });
  }
}

/**
 * GET /api/official-members/:clubId/filter
 * Filter official members by isActive, isClaimed status
 */
async function filterOfficialMembers(req, res) {
  try {
    const { clubId } = req.params;
    const { isActive, isClaimed } = req.query;
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Check user's membership status
    const memberCheck = await verifyClubMember(clubId, userId);
    const adminCheck = await verifyClubAdmin(clubId, userId);

    const userStatus = {
      isMember: memberCheck.isMember,
      isAdmin: adminCheck.isAdmin,
    };

    // Check visibility permission
    if (!checkVisibilityPermission(club, userStatus)) {
      return res.status(403).json({ message: 'You do not have permission to filter official members' });
    }

    // Build filter query
    const filterQuery = { club: clubId };

    if (isActive !== undefined) {
      filterQuery.isActive = isActive === 'true';
    }

    if (isClaimed !== undefined) {
      if (isClaimed === 'true') {
        filterQuery.claimedBy = { $exists: true, $ne: null };
      } else {
        filterQuery.$or = [
          { claimedBy: { $exists: false } },
          { claimedBy: null },
        ];
      }
    }

    // Get total count
    const total = await OfficialMember.countDocuments(filterQuery);

    // Filter official members
    const officialMembers = await OfficialMember.find(filterQuery)
      .populate('club', 'clubName logoUrl')
      .populate('claimedBy', 'username email firstName lastName profilePhoto')
      .sort({ _id: 1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      officialMembers,
      filters: { isActive, isClaimed },
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error filtering official members:', error);
    return res.status(500).json({
      message: 'Server error filtering official members',
      error: error?.message || error,
    });
  }
}

// ==================== CLAIM FUNCTIONS ====================

/**
 * POST /api/official-members/:clubId/members/:memberId/claim
 * Create a claim request for an official member (member only)
 */
async function createClaimRequest(req, res) {
  try {
    const { clubId, memberId } = req.params;
    const userId = req.user._id;
    const { verificationNotes } = req.body;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !memberId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is member
    const memberCheck = await verifyClubMember(clubId, userId);
    if (!memberCheck.isMember) {
      return res.status(403).json({ message: memberCheck.error });
    }

    // Find official member
    const officialMember = await OfficialMember.findOne({
      _id: memberId,
      club: clubId,
    });

    if (!officialMember) {
      return res.status(404).json({ message: 'Official member not found' });
    }

    // Check if member is already claimed
    if (officialMember.claimedBy) {
      return res.status(400).json({ message: 'This official member is already claimed' });
    }

    // Check for existing pending claim
    const existingClaim = await ClaimRequest.findOne({
      officialMember: memberId,
      user: userId,
      status: 'pending',
    });

    if (existingClaim) {
      return res.status(400).json({ message: 'You already have a pending claim request for this member' });
    }

    // Create claim request
    const claimRequest = new ClaimRequest({
      officialMember: memberId,
      club: clubId,
      user: userId,
      verificationNotes: verificationNotes?.trim(),
    });

    await claimRequest.save();

    // Populate for response
    await claimRequest.populate('officialMember');
    await claimRequest.populate('user', 'username email firstName lastName profilePhoto');

    return res.status(201).json({
      message: 'Claim request created successfully',
      claimRequest,
    });
  } catch (error) {
    console.error('Error creating claim request:', error);
    return res.status(500).json({
      message: 'Server error creating claim request',
      error: error?.message || error,
    });
  }
}

/**
 * GET /api/official-members/:clubId/claims/pending
 * Get all pending claim requests (admin only)
 */
async function getPendingClaimRequests(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin
    const adminCheck = await verifyClubAdmin(clubId, userId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Get pending claim requests
    const claimRequests = await ClaimRequest.find({
      club: clubId,
      status: 'pending',
    })
      .populate('officialMember', 'officialNumber firstName lastName plateNumber')
      .populate('user', 'username email firstName lastName profilePhoto')
      .sort({ createdAt: -1 });

    return res.status(200).json({ claimRequests });
  } catch (error) {
    console.error('Error getting pending claim requests:', error);
    return res.status(500).json({
      message: 'Server error getting pending claim requests',
      error: error?.message || error,
    });
  }
}

/**
 * POST /api/official-members/:clubId/claims/:claimId/approve
 * Approve a claim request (admin only)
 */
async function approveClaimRequest(req, res) {
  try {
    const { clubId, claimId } = req.params;
    const userId = req.user._id;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !claimId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin
    const adminCheck = await verifyClubAdmin(clubId, userId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Find claim request
    const claimRequest = await ClaimRequest.findOne({
      _id: claimId,
      club: clubId,
      status: 'pending',
    });

    if (!claimRequest) {
      return res.status(404).json({ message: 'Claim request not found or already processed' });
    }

    // Find official member
    const officialMember = await OfficialMember.findById(claimRequest.officialMember);
    if (!officialMember) {
      return res.status(404).json({ message: 'Official member not found' });
    }

    // Check if already claimed
    if (officialMember.claimedBy) {
      return res.status(400).json({ message: 'This official member is already claimed by another user' });
    }

    // Update official member with claim info
    officialMember.claimedBy = claimRequest.user;
    officialMember.claimedAt = new Date();
    await officialMember.save();

    // Update claim request status
    claimRequest.status = 'approved';
    claimRequest.processedAt = new Date();
    await claimRequest.save();

    // Populate for response
    await officialMember.populate('claimedBy', 'username email firstName lastName profilePhoto');

    return res.status(200).json({
      message: 'Claim request approved successfully',
      officialMember,
      claimRequest,
    });
  } catch (error) {
    console.error('Error approving claim request:', error);
    return res.status(500).json({
      message: 'Server error approving claim request',
      error: error?.message || error,
    });
  }
}

/**
 * POST /api/official-members/:clubId/claims/:claimId/reject
 * Reject a claim request (admin only)
 */
async function rejectClaimRequest(req, res) {
  try {
    const { clubId, claimId } = req.params;
    const { responseNotes } = req.body;
    const userId = req.user._id;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !claimId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin
    const adminCheck = await verifyClubAdmin(clubId, userId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Find claim request
    const claimRequest = await ClaimRequest.findOne({
      _id: claimId,
      club: clubId,
      status: 'pending',
    });

    if (!claimRequest) {
      return res.status(404).json({ message: 'Claim request not found or already processed' });
    }

    // Update claim request status
    claimRequest.status = 'rejected';
    claimRequest.responseNotes = responseNotes?.trim();
    claimRequest.processedAt = new Date();
    await claimRequest.save();

    // Populate for response
    await claimRequest.populate('officialMember');
    await claimRequest.populate('user', 'username email firstName lastName');

    return res.status(200).json({
      message: 'Claim request rejected successfully',
      claimRequest,
    });
  } catch (error) {
    console.error('Error rejecting claim request:', error);
    return res.status(500).json({
      message: 'Server error rejecting claim request',
      error: error?.message || error,
    });
  }
}

/**
 * GET /api/official-members/:clubId/claims/my-requests
 * Get current user's claim requests for this club
 */
async function getMyClaimRequests(req, res) {
  try {
    const { clubId } = req.params;
    const userId = req.user._id;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Get user's claim requests
    const claimRequests = await ClaimRequest.find({
      club: clubId,
      user: userId,
    })
      .populate('officialMember', 'officialNumber firstName lastName plateNumber')
      .sort({ createdAt: -1 });

    return res.status(200).json({ claimRequests });
  } catch (error) {
    console.error('Error getting user claim requests:', error);
    return res.status(500).json({
      message: 'Server error getting claim requests',
      error: error?.message || error,
    });
  }
}

// ==================== ID CARD FUNCTION ====================

/**
 * GET /api/official-members/:clubId/members/:memberId/id-card
 * Generate ID card for an official member
 */
async function generateIDCard(req, res) {
  try {
    const { clubId, memberId } = req.params;
    const userId = req.user._id;

    // Validate IDs format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/) || !memberId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Check user's membership status
    const memberCheck = await verifyClubMember(clubId, userId);
    const adminCheck = await verifyClubAdmin(clubId, userId);

    const userStatus = {
      isMember: memberCheck.isMember,
      isAdmin: adminCheck.isAdmin,
    };

    // Check visibility permission
    if (!checkVisibilityPermission(club, userStatus)) {
      return res.status(403).json({ message: 'You do not have permission to view this ID card' });
    }

    // Get official member with all populated fields
    const officialMember = await OfficialMember.findOne({
      _id: memberId,
      club: clubId,
    })
      .populate('club', 'clubName logoUrl')
      .populate('claimedBy', 'username email firstName lastName profilePhoto');

    if (!officialMember) {
      return res.status(404).json({ message: 'Official member not found' });
    }

    // Generate ID card (placeholder - requires IDCardService)
    // TODO: Implement IDCardService.generateIDCard()
    const idCardBuffer = Buffer.from('');

    // Set appropriate headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="id-card-${memberId}.png"`);

    return res.send(idCardBuffer);
  } catch (error) {
    console.error('Error generating ID card:', error);
    return res.status(500).json({
      message: 'Server error generating ID card',
      error: error?.message || error,
    });
  }
}

// ==================== VISIBILITY FUNCTIONS ====================

/**
 * PUT /api/official-members/:clubId/visibility
 * Update official members visibility setting (admin only)
 */
async function updateOfficialMembersVisibility(req, res) {
  try {
    const { clubId } = req.params;
    const { visibility } = req.body;
    const userId = req.user._id;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Validate visibility value
    const validVisibilities = ['public', 'members', 'admins'];
    if (!visibility || !validVisibilities.includes(visibility)) {
      return res.status(400).json({
        message: 'Invalid visibility value. Must be one of: public, members, admins',
      });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    // Verify user is admin
    const adminCheck = await verifyClubAdmin(clubId, userId);
    if (!adminCheck.isAdmin) {
      return res.status(403).json({ message: adminCheck.error });
    }

    // Update visibility
    club.officialMembersVisibility = visibility;
    await club.save();

    return res.status(200).json({
      message: 'Visibility updated successfully',
      visibility: club.officialMembersVisibility,
    });
  } catch (error) {
    console.error('Error updating official members visibility:', error);
    return res.status(500).json({
      message: 'Server error updating visibility',
      error: error?.message || error,
    });
  }
}

/**
 * GET /api/official-members/:clubId/visibility
 * Get current official members visibility setting
 */
async function getOfficialMembersVisibility(req, res) {
  try {
    const { clubId } = req.params;

    // Validate clubId format
    if (!clubId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ message: 'Invalid club ID format' });
    }

    // Verify club exists
    const club = await Club.findById(clubId);
    if (!club) {
      return res.status(404).json({ message: 'Club not found' });
    }

    return res.status(200).json({
      visibility: club.officialMembersVisibility || 'members',
    });
  } catch (error) {
    console.error('Error getting official members visibility:', error);
    return res.status(500).json({
      message: 'Server error getting visibility',
      error: error?.message || error,
    });
  }
}

// ==================== EXPORTS ====================

export {
  // Helper functions
  verifyClubAdmin,
  verifyClubMember,
  checkVisibilityPermission,

  // CRUD functions
  createOfficialMember,
  getOfficialMembers,
  getOfficialMemberById,
  updateOfficialMember,
  deleteOfficialMember,

  // CSV functions
  importOfficialMembersFromCSV,
  exportOfficialMembersToCSV,

  // Search/filter functions
  searchOfficialMembers,
  filterOfficialMembers,

  // Claim functions
  createClaimRequest,
  getPendingClaimRequests,
  approveClaimRequest,
  rejectClaimRequest,
  getMyClaimRequests,

  // ID card function
  generateIDCard,

  // Visibility functions
  updateOfficialMembersVisibility,
  getOfficialMembersVisibility,
};
