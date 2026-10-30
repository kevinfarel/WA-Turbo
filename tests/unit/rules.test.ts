import { describe, expect, it } from 'vitest';
import { ackStrength, evaluate, isAck, isDeferral, related, sameAsk, type RuleInput } from '../../src/main/loops/rules';

const dm = (text: string, fromMe = false): RuleInput => ({ fromMe, text, isGroup: false, chatHasPartner: false, mentionsMe: false, quotesMine: false });
const group = (text: string, o: Partial<RuleInput> = {}): RuleInput => ({ fromMe: false, text, isGroup: true, chatHasPartner: false, mentionsMe: false, quotesMine: false, ...o });

const PAY_ASK = 'Halo ka mau konfirmasi jika sudah di payment, minta tolong bukti transfer nya ya ka.. Terima kasih 🙏';

describe('local loop rules', () => {
  it('turns a question in a partner-tagged group into an owed question', () => {
    const r = evaluate(group('If the order ships late, do you refund the delivery fee or send a voucher? We need this before Friday.', { chatHasPartner: true }), []);
    expect(r).toMatchObject({ type: 'create', dir: 'owed', kind: 'question', slaH: 24 });
  });

  it('ignores questions in untagged groups unless aimed at you', () => {
    expect(evaluate(group('Pak Dimas, kapan jadwal meeting-nya?'), [])).toBeNull();
    expect(evaluate(group('Can you check the invoice?', { mentionsMe: true }), [])).toMatchObject({ type: 'create', dir: 'owed' });
    expect(evaluate(group('Can you check the invoice?', { quotesMine: true }), [])).toMatchObject({ type: 'create', dir: 'owed' });
  });

  it('turns your promise into an owed commitment', () => {
    expect(evaluate(dm('Noted, I will send both today.', true), [])).toMatchObject({ type: 'create', dir: 'owed', kind: 'commitment' });
  });

  it('turns your ask into a waiting confirmation', () => {
    const r = evaluate(dm('The new price list is attached. Please confirm once you have checked it.', true), []);
    expect(r).toMatchObject({ type: 'create', dir: 'waiting', kind: 'confirmation', slaH: 48 });
  });

  it('turns a payment-proof request into an owed confirmation', () => {
    expect(evaluate(dm(PAY_ASK), [])).toMatchObject({ type: 'create', dir: 'owed', kind: 'confirmation' });
  });

  it('logs your follow-up as a nudge on the open waiting loop', () => {
    const r = evaluate(dm('Following up on the price list — any update?', true), [{ id: 'L3', dir: 'waiting', topic: 'Please confirm the price list' }]);
    expect(r).toEqual({ type: 'nudge', loopId: 'L3', by: 'me' });
  });

  it('counts their chase on an owed loop instead of opening a new one', () => {
    const r = evaluate(dm('Any luck with the invoice? Finance is still waiting on our side.'), [{ id: 'L5', dir: 'owed', topic: 'Can you send the invoice?' }]);
    expect(r).toEqual({ type: 'nudge', loopId: 'L5', by: 'them' });
  });

  it('counts the same ask sent again as a chase, not a second loop', () => {
    const r = evaluate(dm(PAY_ASK), [{ id: 'L9', dir: 'owed', topic: PAY_ASK }]);
    expect(r).toEqual({ type: 'nudge', loopId: 'L9', by: 'them' });
  });

  it('skips acknowledgements, short texts and plain statements', () => {
    for (const t of ['ok', 'Noted', 'thanks!', 'siap 🙏', 'Terima kasih', '👍', 'Baik ka', 'Siap pak 🙏']) expect(evaluate(dm(t), [])).toBeNull();
    expect(evaluate(dm('Received, I will forward to our team.'), [])).toBeNull();
  });
});

describe('settling loops', () => {
  it('reads thanks and short confirmations as an acknowledgement', () => {
    for (const t of ['Terima kasih banyak atas pembayarannya ka 🙏', 'ok noted', 'Baik ka', '👍', 'Sudah diterima, makasih', 'Thanks, got it']) expect(isAck(t)).toBe(true);
  });

  it('does not read a new question as an acknowledgement', () => {
    for (const t of ['Ok, bisa kirim invoice-nya juga?', 'Thanks — can you also send the receipt?', 'Jadi kapan dikirim?']) expect(isAck(t)).toBe(false);
  });

  it('tells thanks apart from a plain "ok"', () => {
    expect(ackStrength('Terima kasih banyak atas pembayarannya ka 🙏')).toBe(2);
    expect(ackStrength('Baik ka')).toBe(1);
    expect(ackStrength('👍')).toBe(1);
  });

  it('sees a photo or shared words as a reply about the ask', () => {
    expect(related(PAY_ASK, { text: '', type: 'image' })).toBe(true);
    expect(related(PAY_ASK, { text: 'Sudah transfer ya ka', type: 'text' })).toBe(true);
    expect(related(PAY_ASK, { text: 'saya mau pesen 2 lagi ya nanti sekalian jam 8 ya', type: 'text' })).toBe(false);
  });

  it('treats "I\'ll check" as postponing, not answering', () => {
    expect(isDeferral('Ok saya cek dulu ya')).toBe(true);
    expect(isDeferral("Let me check and get back to you")).toBe(true);
    expect(isDeferral('Sudah saya transfer ya ka')).toBe(false);
  });

  it('matches the same ask, not a different one', () => {
    expect(sameAsk(PAY_ASK, 'Halo ka mau konfirmasi jika sudah di payment, minta tolong bukti transfernya ya ka')).toBe(true);
    expect(sameAsk(PAY_ASK, 'Halo ka, mau tanya stok warna hitam masih ada?')).toBe(false);
  });
});
