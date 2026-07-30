import assert from 'node:assert/strict';
import test from 'node:test';
import { isStoredPasswordPrompt } from '../electron/main/authPrompt';

test('stored passwords are used only for explicit static password prompts', () => {
  assert.equal(isStoredPasswordPrompt('Password:'), true);
  assert.equal(isStoredPasswordPrompt('Enter passwd'), true);
  assert.equal(isStoredPasswordPrompt('请输入密码：'), true);
  assert.equal(isStoredPasswordPrompt('Passcode:'), false);
  assert.equal(isStoredPasswordPrompt('One-time password:'), false);
  assert.equal(isStoredPasswordPrompt('New password:'), false);
  assert.equal(isStoredPasswordPrompt('Retype password:'), false);
  assert.equal(isStoredPasswordPrompt('请输入动态密码'), false);
  assert.equal(isStoredPasswordPrompt('请输入新密码'), false);
  assert.equal(isStoredPasswordPrompt('短信验证码'), false);
  assert.equal(isStoredPasswordPrompt('Verification code:'), false);
});
