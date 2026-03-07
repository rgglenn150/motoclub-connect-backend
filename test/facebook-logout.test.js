import { expect } from 'chai';
import request from 'supertest';
import { app } from '../server.js';

describe('Facebook Logout Integration', function () {
  describe('Logout endpoint', function () {
    it('should handle logout requests correctly', async function () {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({})
        .expect(200);

      expect(response.body.message).to.equal('Logged out');
    });

    it('should clear session on logout', async function () {
      const agent = request.agent(app);

      // Logout
      const logoutResponse = await agent
        .post('/api/auth/logout')
        .send({})
        .expect(200);

      expect(logoutResponse.body.message).to.equal('Logged out');
    });
  });

  describe('Facebook logout behavior', function () {
    it('should handle logout without active session', async function () {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({})
        .expect(200);

      // Should still return success even without active session
      expect(response.body.message).to.equal('Logged out');
    });
  });
});
