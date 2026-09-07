// Disposable visual-review API. Synthetic identities, in-memory storage, mock providers only.
import { writeFile } from 'node:fs/promises';
import { buildApp } from '../../apps/api/src/app.ts';
import { CallService } from '../../apps/api/src/call-service.ts';
import { InMemoryCallRepository } from '../../apps/api/src/storage/in-memory-call-repository.ts';
import { InMemoryAuthRepository } from '../../apps/api/src/auth/in-memory-auth-repository.ts';
import { AuthService } from '../../apps/api/src/auth/auth-service.ts';
import { MockVerificationProvider } from '../../apps/api/src/auth/verification-provider.ts';
import { MockEmailProvider } from '../../apps/api/src/auth/email-provider.ts';
import { MockTelephonyProvider } from '../../apps/api/src/telephony/mock-telephony-provider.ts';
import { CreditService } from '../../apps/api/src/credits/credit-service.ts';
import { ContentService } from '../../apps/api/src/content/content-service.ts';
import { InMemoryContentRepository } from '../../apps/api/src/content/in-memory-content-repository.ts';
import { hashPassword } from '../../apps/api/src/auth/password.ts';

class ReviewTelephony extends MockTelephonyProvider {
  async getRecordingMedia() {
    const samples = 8000 * 66;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    return { bytes: wav, contentType: 'audio/wav', fileName: 'synthetic-silent-review.wav' };
  }
}
const repository = new InMemoryCallRepository();
const authRepository = new InMemoryAuthRepository();
const service = new CallService(repository, new ReviewTelephony());
const contentService = new ContentService(new InMemoryContentRepository());
await contentService.initialize();
const authService = new AuthService({ repository: authRepository, verificationProvider: new MockVerificationProvider('000000'), emailProvider: new MockEmailProvider(), emailVerificationHashKey: Buffer.alloc(32, 12), emailVerificationCode: () => '654321', signupCreditGranter: service });
const creditService = new CreditService({repository, authRepository, hashKey: Buffer.alloc(32, 7)});
const password = 'EmeraldReview2026!';
async function seedUser(email: string, phoneE164: string, role: 'user' | 'superadmin') {
  const user = await authRepository.createUser({ firstName: role === 'user' ? 'Nina' : 'Alex', lastName: 'Review', email, phoneE164, passwordHash: await hashPassword(password), uiLocale: 'en' });
  await authRepository.markPhoneVerified(user.id, new Date().toISOString());
  await authRepository.setUserRoleForTest(user.id, role);
  await service.grantSignupCredits(user.id);
  const status = await contentService.getOnboardingStatus(user.id, 'en');
  await contentService.acceptOnboarding(user.id, { locale: 'en', termsRevisionId: status.current.terms.id, acceptableUseRevisionId: status.current.acceptableUse.id, acceptTerms: true, acceptAcceptableUse: true, acknowledgeConsent: true, acknowledgeRetention: true, acknowledgeUseLimits: true, acknowledgeCredits: true });
  return user;
}
const customer = await seedUser('customer@review.example', '+41710000061', 'user');
const admin = await seedUser('admin@review.example', '+41710000062', 'superadmin');
const input = { recipientName: 'Municipal office', phoneNumber: '+41710000064', objective: 'Check whether the residence form arrived and whether documents are missing.', assistantProfileId: 'sebastian', representedPersonFirstName: 'Nina', representedPersonLastName: 'Review', assistanceReason: 'none', locale: 'de-CH', allowLanguageSwitch: false, audioRetentionDays: 7, allowedFacts: [] } as const;
const completed = await service.create({...input, allowedFacts: []}, customer.id);
await repository.approveCompilation(completed.id);
const attempt = await repository.startAttempt(completed.id, {provider: 'twilio'});
const providerCallId = 'CA-review-' + completed.id;
await repository.attachProviderCall(attempt.attempt.id, providerCallId, 'in-progress');
const recording = await repository.beginRecording(completed.id);
const providerRecordingId = 'RE-review-' + completed.id;
await repository.attachProviderRecording(recording.recording.id, providerRecordingId, 'in-progress');
const segments = [
 {role:'assistant', text:'Guten Tag. Ich bin Sebastian, ein KI-Assistent. Ich rufe im Auftrag von Nina Review an. Darf ich fortfahren?', startSeconds:0, endSeconds:10},
 {role:'recipient', text:'Ja, gerne. Worum geht es?', startSeconds:10, endSeconds:15},
 {role:'assistant', text:'Ich möchte prüfen, ob das Formular eingegangen ist und ob noch Unterlagen fehlen.', startSeconds:15, endSeconds:27},
 {role:'recipient', text:'Das Formular ist angekommen. Eine Kopie des Ausweises fehlt noch.', startSeconds:27, endSeconds:43},
 {role:'assistant', text:'Vielen Dank. Ich gebe diese Information an Nina weiter. Auf Wiederhören.', startSeconds:43, endSeconds:60}
] as const;
for (const segment of segments) await repository.addTranscript(completed.id, segment.role, segment.text, 'de-CH');
await repository.applyRecordingStatus({callBriefId: completed.id, recordingId: recording.recording.id, providerCallId, providerRecordingId, providerStatus: 'completed', durationSeconds:66, channels:2});
await repository.claimFinalTranscript(recording.recording.id, 'review-transcriber');
await repository.completeFinalTranscript(recording.recording.id, segments.map(s => s.text).join('\n'), [...segments]);
await repository.updateStatus(completed.id, 'completed');
const review = await service.create({...input, recipientName: 'Library desk', objective: 'Ask whether my reserved book is ready to collect.', allowedFacts: []}, customer.id);
const failed = await service.create({...input, recipientName: 'Service desk', allowedFacts: []}, customer.id);
await repository.updateStatus(failed.id, 'failed');
await service.initialize();
const app = buildApp({service, authService, creditService, contentService, logger: false, production: false, secureCookies: false, webOrigin: 'http://localhost:3000'});
await app.listen({host:'127.0.0.1', port:4040});
await writeFile(new URL('./fixtures.json', import.meta.url), JSON.stringify({customer: customer.email, admin: admin.email, password, completed: completed.id, review: review.id, failed: failed.id}, null, 2));
console.log('Synthetic review API ready on 4040');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); await service.close(); process.exit(0); });
