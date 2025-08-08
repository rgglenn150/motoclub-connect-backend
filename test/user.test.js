import { getUser } from '../controllers/userController.js';
import User from '../models/UserModel.js';
import assert from 'assert';

describe('getUser', () => {
  let req, res;
  let originalFind;

  beforeEach(() => {
    req = {};
    res = {
      status: function(code) {
        this.statusCode = code;
        return this;
      },
      json: function(data) {
        this.body = data;
      },
      statusCode: 0,
      body: null
    };
    originalFind = User.find;
  });

  afterEach(() => {
    User.find = originalFind;
  });

  it('should return all users with status 200', async () => {
    const mockUsers = [{ name: 'User 1' }, { name: 'User 2' }];
    User.find = () => Promise.resolve(mockUsers);

    await getUser(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body, mockUsers);
  });

  it('should return 500 if an error occurs', async () => {
    const errorMessage = 'Database error';
    User.find = () => Promise.reject(new Error(errorMessage));

    await getUser(req, res);

    assert.strictEqual(res.statusCode, 500);
    assert.deepStrictEqual(res.body, { message: errorMessage });
  });
});