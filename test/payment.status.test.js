import { expect } from 'chai';
import sinon from 'sinon';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../server.js';
import Payment from '../models/PaymentModel.js';
import Member from '../models/MemberModel.js';

const PAYMENT_ID = '507f191e810c19729de860aa';
const CLUB_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439099';

// Spec 001, Story 5 / constitution VII: payment status only moves
// pending → confirmed | rejected (contracts/payment.md). DB calls are stubbed.
describe('PATCH /api/payment/:paymentId/status', () => {
  let token;

  const patch = (status) =>
    request(app)
      .patch(`/api/payment/${PAYMENT_ID}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send(status === undefined ? {} : { status });

  function stubPayment(status) {
    sinon
      .stub(Payment, 'findById')
      .resolves(status && { _id: PAYMENT_ID, club: CLUB_ID, status });
  }

  beforeEach(() => {
    token = jwt.sign({ _id: USER_ID }, process.env.JWT_SECRET);
  });

  afterEach(() => sinon.restore());

  for (const target of ['confirmed', 'rejected']) {
    it(`resolves a pending payment as ${target}`, async () => {
      stubPayment('pending');
      sinon.stub(Member, 'findOne').resolves({ roles: ['admin'] });
      const update = sinon
        .stub(Payment, 'findOneAndUpdate')
        .resolves({ _id: PAYMENT_ID, club: CLUB_ID, status: target });

      const res = await patch(target);

      expect(res.status).to.equal(200);
      expect(res.body.payment.status).to.equal(target);
      // Atomic: only matches while the payment is still pending.
      expect(update.firstCall.args[0]).to.deep.equal({
        _id: PAYMENT_ID,
        status: 'pending',
      });
      expect(update.firstCall.args[1]).to.deep.equal({ status: target });
    });
  }

  for (const target of [undefined, 'pending', 'paid']) {
    it(`rejects ${target === undefined ? 'a missing' : `"${target}" as a`} target status`, async () => {
      const find = sinon.stub(Payment, 'findById');

      const res = await patch(target);

      expect(res.status).to.equal(400);
      expect(res.body.message).to.equal(
        'Invalid status. Must be confirmed or rejected.'
      );
      expect(find.called).to.equal(false);
    });
  }

  for (const current of ['confirmed', 'rejected']) {
    it(`refuses to change a ${current} payment`, async () => {
      stubPayment(current);
      sinon.stub(Member, 'findOne').resolves({ roles: ['admin'] });
      const update = sinon.stub(Payment, 'findOneAndUpdate').resolves(null);

      const res = await patch(
        current === 'confirmed' ? 'rejected' : 'confirmed'
      );

      expect(res.status).to.equal(409);
      expect(res.body).to.deep.equal({
        message: `Payment is already ${current} and can't be changed.`,
        status: current,
      });
      expect(update.called).to.equal(false);
    });
  }

  it('refuses when another admin resolved it first', async () => {
    const find = sinon.stub(Payment, 'findById');
    find
      .onFirstCall()
      .resolves({ _id: PAYMENT_ID, club: CLUB_ID, status: 'pending' });
    find
      .onSecondCall()
      .resolves({ _id: PAYMENT_ID, club: CLUB_ID, status: 'rejected' });
    sinon.stub(Member, 'findOne').resolves({ roles: ['admin'] });
    sinon.stub(Payment, 'findOneAndUpdate').resolves(null);

    const res = await patch('confirmed');

    expect(res.status).to.equal(409);
    expect(res.body.status).to.equal('rejected');
  });

  it('forbids non-admins', async () => {
    stubPayment('pending');
    sinon.stub(Member, 'findOne').resolves(null);
    const update = sinon.stub(Payment, 'findOneAndUpdate');

    const res = await patch('confirmed');

    expect(res.status).to.equal(403);
    expect(update.called).to.equal(false);
  });

  it('returns 404 for an unknown payment', async () => {
    stubPayment(null);

    const res = await patch('confirmed');

    expect(res.status).to.equal(404);
  });
});
