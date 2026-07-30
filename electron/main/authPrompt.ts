const DYNAMIC_CREDENTIAL_HINTS = [
  'passcode',
  'one-time',
  'one time',
  'new password',
  'confirm password',
  'repeat password',
  'retype password',
  'verification code',
  'security code',
  'auth code',
  'otp',
  'token',
  '验证码',
  '认证码',
  '校验码',
  '动态',
  '一次性',
  '短信',
  '新密码',
  '确认密码',
  '重复密码',
];

export const isStoredPasswordPrompt = (prompt: string): boolean => {
  const normalized = String(prompt || '').normalize('NFKC').trim().toLocaleLowerCase();
  if (DYNAMIC_CREDENTIAL_HINTS.some((hint) => normalized.includes(hint))) return false;
  return normalized.includes('password') || normalized.includes('passwd') || normalized.includes('密码');
};
