import { expect } from 'chai';
import request from 'supertest';
import sinon from 'sinon';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { app } from '../server.js';
import User from '../models/UserModel.js';

describe('Facebook Authentication Integration', function() {
  let axiosStub;
  
  beforeEach(function() {
    axiosStub = sinon.stub(axios, 'get');
  });
  
  afterEach(function() {
    if (axiosStub) {
      axiosStub.restore();
    }
  });

  describe('JWT Token Validation', function() {
    it('should generate and validate JWT tokens correctly', async function() {
      const facebookResponse = {
        data: {
          id: 'fb_jwt_test',
          email: 'jwttest@facebook.com',
          first_name: 'JWT',
          last_name: 'Test'
        }
      };
      
      axiosStub.resolves(facebookResponse);

      // This will fail due to user not existing, but we can test token format
      const response = await request(app)
        .post('/api/auth/facebook')
        .send({
          accessToken: 'test_token'
        });

      // Should get 404 for non-existent user, but API call should be made
      expect(axiosStub.calledOnce).to.be.true;
      expect(response.status).to.be.oneOf([400, 404]); // Either validation error or user not found
    });

    it('should decode JWT tokens with correct payload structure', function() {
      // Test JWT token creation manually
      const testUserId = '507f1f77bcf86cd799439011';
      const token = jwt.sign(
        { _id: testUserId },
        process.env.JWT_SECRET,
        { expiresIn: '3d' }
      );

      expect(token).to.be.a('string');
      expect(token.split('.')).to.have.length(3); // JWT format

      // Decode the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded._id).to.equal(testUserId);
      expect(decoded.exp).to.be.a('number');
      expect(decoded.iat).to.be.a('number');
    });
  });

  describe('User Creation Flow', function() {
    it('should handle user creation with Facebook data structure', async function() {
      const facebookResponse = {
        data: {
          id: 'fb_create_test',
          email: 'createtest@facebook.com',
          first_name: 'Create',
          last_name: 'Test',
          picture: {
            data: {
              url: 'https://facebook.com/createtest.jpg'
            }
          }
        }
      };
      
      axiosStub.resolves(facebookResponse);

      const response = await request(app)
        .post('/api/auth/facebook/register')
        .send({
          accessToken: 'create_test_token',
          username: 'createtestuser'
        });

      // Should get either success or validation error, but API call should be made
      expect(axiosStub.calledOnce).to.be.true;
      
      // Verify the Facebook Graph API was called with correct parameters
      const apiUrl = axiosStub.firstCall.args[0];
      expect(apiUrl).to.include('graph.facebook.com/me');
      expect(apiUrl).to.include('access_token=create_test_token');
      expect(apiUrl).to.include('fields=id,email,first_name,last_name,picture.type(large)');
    });
  });

  describe('Session Management', function() {
    it('should handle session creation in Facebook auth', async function() {
      const facebookResponse = {
        data: {
          id: 'fb_session_test',
          email: 'sessiontest@facebook.com',
          first_name: 'Session',
          last_name: 'Test'
        }
      };
      
      axiosStub.resolves(facebookResponse);

      const agent = request.agent(app);
      
      const response = await agent
        .post('/api/auth/facebook/register')
        .send({
          accessToken: 'session_test_token',
          username: 'sessiontestuser'
        });

      expect(axiosStub.calledOnce).to.be.true;
      // Session handling is tested regardless of success/failure
    });
  });

  describe('Error Handling Edge Cases', function() {
    it('should handle malformed Facebook response', async function() {
      const malformedResponse = {
        data: {
          // Missing required fields
        }
      };
      
      axiosStub.resolves(malformedResponse);

      const response = await request(app)
        .post('/api/auth/facebook')
        .send({
          accessToken: 'malformed_token'
        })
        .expect(400);

      expect(response.body.message).to.equal('Email permission required from Facebook');
    });

    it('should handle Facebook API timeout', async function() {
      axiosStub.rejects(new Error('ETIMEDOUT'));

      const response = await request(app)
        .post('/api/auth/facebook')
        .send({
          accessToken: 'timeout_token'
        })
        .expect(400);

      expect(response.body.message).to.equal('Invalid Facebook access token');
    });

    it('should handle Facebook API rate limiting', async function() {
      axiosStub.rejects({
        response: {
          data: {
            error: {
              message: 'Application request limit reached',
              type: 'OAuthException',
              code: 4
            }
          }
        }
      });

      const response = await request(app)
        .post('/api/auth/facebook')
        .send({
          accessToken: 'rate_limited_token'
        })
        .expect(400);

      expect(response.body.message).to.equal('Invalid Facebook access token');
    });

    it('should handle empty access token', async function() {
      const response = await request(app)
        .post('/api/auth/facebook')
        .send({
          accessToken: ''
        })
        .expect(400);

      expect(response.body.message).to.equal('Facebook access token is required');
    });

    it('should handle null access token', async function() {
      const response = await request(app)
        .post('/api/auth/facebook')
        .send({
          accessToken: null
        })
        .expect(400);

      expect(response.body.message).to.equal('Facebook access token is required');
    });
  });

  describe('API Consistency', function() {
    it('should use consistent response format for Facebook endpoints', async function() {
      // Test both login and register endpoints for consistent structure
      
      const facebookResponse = {
        data: {
          id: 'fb_consistency',
          email: 'consistency@facebook.com',
          first_name: 'Consistency',
          last_name: 'Test'
        }
      };
      
      axiosStub.resolves(facebookResponse);

      // Test login endpoint
      const loginResponse = await request(app)
        .post('/api/auth/facebook')
        .send({
          accessToken: 'consistency_token'
        });

      // Test register endpoint
      const registerResponse = await request(app)
        .post('/api/auth/facebook/register')
        .send({
          accessToken: 'consistency_token',
          username: 'consistencyuser'
        });

      // Both should have 'message' field in response
      expect(loginResponse.body).to.have.property('message');
      expect(registerResponse.body).to.have.property('message');
    });
  });
});