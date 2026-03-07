import sharp from 'sharp';
import OfficialMemberModel from '../models/OfficialMemberModel.js';
import axios from 'axios';

/**
 * ID Card Service for generating official member ID cards
 * Creates professional PNG ID cards using sharp and SVG templates
 */
class IDCardService {
  // Card dimensions (CR-80 size at 300 DPI)
  static CARD_WIDTH = 1012;
  static CARD_HEIGHT = 638;

  // Color scheme - dark theme
  static COLORS = {
    bgStart: '#1a1a2e',
    bgEnd: '#16213e',
    textPrimary: '#ffffff',
    textSecondary: '#b8c5d6',
    accent: '#e94560',
    border: '#e94560',
    overlay: 'rgba(233, 69, 96, 0.1)',
  };

  /**
   * Generate ID card for an official member
   * @param {string} officialMemberId - The ID of the official member
   * @param {string} clubId - The ID of the club (for validation)
   * @returns {Promise<{contentType: string, buffer: Buffer, filename: string}>}
   */
  static async generateIDCard(officialMemberId, clubId) {
    try {
      // Fetch official member with populated club info
      const member = await OfficialMemberModel.findById(officialMemberId)
        .populate('club')
        .lean();

      if (!member) {
        throw new Error('Official member not found');
      }

      // Validate club matches
      if (!member.club || member.club._id.toString() !== clubId.toString()) {
        throw new Error('Club does not match official member');
      }

      // Generate the SVG template
      const svgTemplate = this.createSVGTemplate(member);

      // Convert SVG to PNG using sharp
      const pngBuffer = await sharp(Buffer.from(svgTemplate))
        .png()
        .toBuffer();

      // Generate filename
      const filename = `id-card-${member.officialNumber}-${Date.now()}.png`;

      return {
        contentType: 'image/png',
        buffer: pngBuffer,
        filename: filename,
      };
    } catch (error) {
      throw new Error(`Failed to generate ID card: ${error.message}`);
    }
  }

  /**
   * Create SVG template for ID card
   * @param {Object} member - Official member document with populated club
   * @returns {string} SVG markup
   */
  static createSVGTemplate(member) {
    const {
      club,
      firstName,
      lastName,
      officialNumber,
      plateNumber,
      address,
      photoUrl,
    } = member;

    const clubName = club?.clubName || 'Motorcycle Club';
    const clubLogo = club?.logoUrl || null;
    const fullName = `${firstName} ${lastName}`;
    const currentYear = new Date().getFullYear();

    // SVG template
    const svg = `
      <svg width="${this.CARD_WIDTH}" height="${this.CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <!-- Background gradient -->
          <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${this.COLORS.bgStart};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${this.COLORS.bgEnd};stop-opacity:1" />
          </linearGradient>

          <!-- Member photo clip path -->
          <clipPath id="photoClip">
            <circle cx="220" cy="319" r="120" />
          </clipPath>

          <!-- Logo clip path -->
          <clipPath id="logoClip">
            <rect x="40" y="40" width="150" height="150" rx="10" />
          </clipPath>

          <!-- Drop shadow filter -->
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.3"/>
          </filter>
        </defs>

        <!-- Background -->
        <rect width="100%" height="100%" fill="url(#bgGradient)" />

        <!-- Decorative border -->
        <rect x="20" y="20" width="${this.CARD_WIDTH - 40}" height="${this.CARD_HEIGHT - 40}"
              fill="none" stroke="${this.COLORS.border}" stroke-width="4" rx="15" />

        <!-- Decorative corner accents -->
        <path d="M 30 30 Q 30 30 40 30 L 80 30" stroke="${this.COLORS.accent}" stroke-width="6" fill="none" stroke-linecap="round" />
        <path d="M 30 30 Q 30 30 30 40 L 30 80" stroke="${this.COLORS.accent}" stroke-width="6" fill="none" stroke-linecap="round" />

        <path d="M ${this.CARD_WIDTH - 30} 30 Q ${this.CARD_WIDTH - 30} 30 ${this.CARD_WIDTH - 40} 30 L ${this.CARD_WIDTH - 80} 30"
              stroke="${this.COLORS.accent}" stroke-width="6" fill="none" stroke-linecap="round" />
        <path d="M ${this.CARD_WIDTH - 30} 30 Q ${this.CARD_WIDTH - 30} 30 ${this.CARD_WIDTH - 30} 40 L ${this.CARD_WIDTH - 30} 80"
              stroke="${this.COLORS.accent}" stroke-width="6" fill="none" stroke-linecap="round" />

        <!-- Club Logo -->
        ${clubLogo ? `
          <image href="${clubLogo}" x="40" y="40" width="150" height="150"
                 clip-path="url(#logoClip)" preserveAspectRatio="xMidYMid meet" />
        ` : `
          <rect x="40" y="40" width="150" height="150" rx="10" fill="${this.COLORS.overlay}" />
          <text x="115" y="115" font-family="Arial, sans-serif" font-size="24" font-weight="bold"
                fill="${this.COLORS.textSecondary}" text-anchor="middle">LOGO</text>
        `}

        <!-- Club Name -->
        <text x="220" y="80" font-family="Arial, sans-serif" font-size="36" font-weight="bold"
              fill="${this.COLORS.textPrimary}">${this.escapeSVG(clubName)}</text>

        <!-- "OFFICIAL MEMBER CARD" badge -->
        <rect x="220" y="100" width="400" height="50" rx="25" fill="${this.COLORS.accent}" opacity="0.9" />
        <text x="420" y="133" font-family="Arial, sans-serif" font-size="24" font-weight="bold"
              fill="${this.COLORS.textPrimary}" text-anchor="middle" letter-spacing="2">
          OFFICIAL MEMBER CARD
        </text>

        <!-- Member Photo Container -->
        <circle cx="220" cy="319" r="120" fill="${this.COLORS.overlay}" />
        ${photoUrl ? `
          <image href="${photoUrl}" x="100" y="199" width="240" height="240"
                 clip-path="url(#photoClip)" preserveAspectRatio="xMidYMid slice" />
        ` : `
          <text x="220" y="325" font-family="Arial, sans-serif" font-size="20" font-weight="bold"
                fill="${this.COLORS.textSecondary}" text-anchor="middle">NO PHOTO</text>
        `}

        <!-- Member Information -->
        <g transform="translate(400, 220)">
          <!-- Member Name -->
          <text x="0" y="0" font-family="Arial, sans-serif" font-size="14" font-weight="bold"
                fill="${this.COLORS.accent}" letter-spacing="1">MEMBER NAME</text>
          <text x="0" y="35" font-family="Arial, sans-serif" font-size="32" font-weight="bold"
                fill="${this.COLORS.textPrimary}">${this.escapeSVG(fullName)}</text>

          <!-- Official Number -->
          <text x="0" y="90" font-family="Arial, sans-serif" font-size="14" font-weight="bold"
                fill="${this.COLORS.accent}" letter-spacing="1">OFFICIAL NUMBER</text>
          <text x="0" y="125" font-family="Arial, sans-serif" font-size="36" font-weight="bold"
                fill="${this.COLORS.textPrimary}">#${this.escapeSVG(officialNumber)}</text>

          <!-- Plate Number -->
          ${plateNumber ? `
            <text x="0" y="180" font-family="Arial, sans-serif" font-size="14" font-weight="bold"
                  fill="${this.COLORS.accent}" letter-spacing="1">PLATE NUMBER</text>
            <text x="0" y="215" font-family="Arial, sans-serif" font-size="28" font-weight="bold"
                  fill="${this.COLORS.textPrimary}">${this.escapeSVG(plateNumber)}</text>
          ` : ''}

          <!-- Address -->
          ${address ? `
            <text x="0" y="${plateNumber ? 270 : 180}" font-family="Arial, sans-serif" font-size="14" font-weight="bold"
                  fill="${this.COLORS.accent}" letter-spacing="1">ADDRESS</text>
            <text x="0" y="${plateNumber ? 305 : 215}" font-family="Arial, sans-serif" font-size="20"
                  fill="${this.COLORS.textSecondary}">${this.escapeSVG(address)}</text>
          ` : ''}
        </g>

        <!-- Footer -->
        <rect x="0" y="${this.CARD_HEIGHT - 80}" width="${this.CARD_WIDTH}" height="80"
              fill="${this.COLORS.overlay}" opacity="0.5" />
        <line x1="20" y1="${this.CARD_HEIGHT - 80}" x2="${this.CARD_WIDTH - 20}" y2="${this.CARD_HEIGHT - 80}"
              stroke="${this.COLORS.accent}" stroke-width="2" />

        <text x="${this.CARD_WIDTH / 2}" y="${this.CARD_HEIGHT - 45}"
              font-family="Arial, sans-serif" font-size="24" font-weight="bold"
              fill="${this.COLORS.textPrimary}" text-anchor="middle" letter-spacing="3">
          VALID MEMBER - ${currentYear}
        </text>

        <text x="${this.CARD_WIDTH / 2}" y="${this.CARD_HEIGHT - 20}"
              font-family="Arial, sans-serif" font-size="14"
              fill="${this.COLORS.textSecondary}" text-anchor="middle">
          This card is the property of ${this.escapeSVG(clubName)}
        </text>
      </svg>
    `;

    return svg;
  }

  /**
   * Escape special characters in SVG text
   * @param {string} text - Text to escape
   * @returns {string} Escaped text safe for SVG
   */
  static escapeSVG(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    };
    return text.toString().replace(/[&<>"']/g, (char) => map[char] || char);
  }

  /**
   * Fetch image from URL and return as buffer
   * @param {string} imageUrl - URL of the image
   * @returns {Promise<Buffer>} Image buffer
   */
  static async fetchImageBuffer(imageUrl) {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
      });
      return Buffer.from(response.data);
    } catch (error) {
      throw new Error(`Failed to fetch image: ${error.message}`);
    }
  }

  /**
   * Generate ID card and return as base64 data URL
   * @param {string} officialMemberId - The ID of the official member
   * @param {string} clubId - The ID of the club
   * @returns {Promise<string>} Base64 data URL
   */
  static async generateIDCardBase64(officialMemberId, clubId) {
    const { buffer } = await this.generateIDCard(officialMemberId, clubId);
    const base64 = buffer.toString('base64');
    return `data:image/png;base64,${base64}`;
  }
}

export default IDCardService;
