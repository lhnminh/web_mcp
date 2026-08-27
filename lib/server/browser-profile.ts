import { ensureAnonymousProfile } from '@/db/projects';

const COOKIE_NAME = 'dwellwise_profile';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BrowserProfile = {
  id: string;
  shouldSetCookie: boolean;
};

const cookieValue = (request: Request, name: string) => {
  const match = request.headers.get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!match) return null;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch {
    return null;
  }
};

export async function resolveBrowserProfile(request: Request): Promise<BrowserProfile> {
  const existing = cookieValue(request, COOKIE_NAME);
  const validExisting = existing && PROFILE_ID_PATTERN.test(existing) ? existing : null;
  const profile = { id: validExisting ?? crypto.randomUUID(), shouldSetCookie: !validExisting };
  await ensureAnonymousProfile(profile.id);
  return profile;
}

export function jsonForProfile(profile: BrowserProfile, body: unknown, init?: ResponseInit): Response {
  const publicBody = JSON.parse(JSON.stringify(body, (key, value) => key === 'ownerProfileId' ? undefined : value)) as unknown;
  const response = Response.json(publicBody, init);
  if (profile.shouldSetCookie) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.headers.append(
      'Set-Cookie',
      `${COOKIE_NAME}=${encodeURIComponent(profile.id)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
    );
  }
  return response;
}
