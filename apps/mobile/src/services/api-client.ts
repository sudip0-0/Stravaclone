import {
  acceptedResponseSchema,
  activityListResponseSchema,
  activityPhotosSchema,
  activitySchema,
  authResponseSchema,
  photoCompleteResponseSchema,
  signedPhotoUploadSchema,
  userSchema,
  type Activity,
  type ActivityListResponse,
  type AuthResponse,
  type CreateActivityRequest,
  type InitiatePhotoUploadRequest,
  type PhotoCompleteResponse,
  type SessionTokens,
  type SignedPhotoUpload,
  type UpdateActivityRequest,
  type UpdateUserRequest,
  type User,
} from '@trail/contracts';
import { ApiResponseError } from './errors';
import type {
  RefreshTransport,
  SessionCoordinator,
} from './session-coordinator';

type Schema<T> = { parse(value: unknown): T };

async function body(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}
async function responseError(response: Response): Promise<ApiResponseError> {
  let code = 'unknown';
  try {
    const envelope = (await body(response)) as { error?: { code?: unknown } };
    if (typeof envelope?.error?.code === 'string') code = envelope.error.code;
  } catch {
    /* Invalid error payloads remain safely generic. */
  }
  return new ApiResponseError(response.status, code);
}
async function expectResponse<T>(
  response: Response,
  schema: Schema<T>,
): Promise<T> {
  if (!response.ok) throw await responseError(response);
  return schema.parse(await body(response));
}
async function expectNoContent(response: Response): Promise<void> {
  if (!response.ok) throw await responseError(response);
}

export class ApiClient implements RefreshTransport {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  session?: SessionCoordinator;

  async refresh(
    refreshToken: string,
    rotationRequestId: string,
  ): Promise<SessionTokens> {
    return (
      await this.auth('/v1/auth/refresh', {
        refresh_token: refreshToken,
        rotation_request_id: rotationRequestId,
      })
    ).session;
  }
  async requestRegistration(email: string, password: string): Promise<void> {
    await expectResponse(
      await this.post('/v1/auth/register', {
        email,
        password,
        display_name: 'Trail user',
      }),
      acceptedResponseSchema,
    );
  }
  confirmRegistration(token: string): Promise<AuthResponse> {
    return this.auth('/v1/auth/register/confirm', {
      token,
      device_hint: 'Trail mobile',
    });
  }
  login(email: string, password: string): Promise<AuthResponse> {
    return this.auth('/v1/auth/login', {
      email,
      password,
      device_hint: 'Trail mobile',
    });
  }
  async requestPasswordReset(email: string): Promise<void> {
    await expectResponse(
      await this.post('/v1/auth/password-reset/request', { email }),
      acceptedResponseSchema,
    );
  }
  async confirmPasswordReset(token: string, password: string): Promise<void> {
    await expectNoContent(
      await this.post('/v1/auth/password-reset/confirm', { token, password }),
    );
  }
  async logout(refreshToken: string): Promise<void> {
    await expectNoContent(
      await this.post('/v1/auth/logout', { refresh_token: refreshToken }),
    );
  }
  async getProfile(): Promise<User> {
    return expectResponse(await this.authorized('/v1/me'), userSchema);
  }
  async updateProfile(patch: UpdateUserRequest): Promise<User> {
    return expectResponse(
      await this.authorized('/v1/me', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
      userSchema,
    );
  }
  async deleteAccount(password: string): Promise<void> {
    await expectNoContent(
      await this.authorized('/v1/me', {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: 'DELETE', password }),
      }),
    );
  }
  async createActivity(payload: CreateActivityRequest): Promise<Activity> {
    return expectResponse(
      await this.authorized('/v1/activities', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      activitySchema,
    );
  }
  async listActivities(
    cursor?: string,
    limit = 50,
  ): Promise<ActivityListResponse> {
    const query = new URLSearchParams({ limit: String(Math.min(200, limit)) });
    if (cursor) query.set('cursor', cursor);
    return expectResponse(
      await this.authorized(`/v1/activities?${query.toString()}`),
      activityListResponseSchema,
    );
  }
  async getActivity(id: string): Promise<Activity> {
    return expectResponse(
      await this.authorized(`/v1/activities/${encodeURIComponent(id)}`),
      activitySchema,
    );
  }
  async updateActivity(
    id: string,
    patch: UpdateActivityRequest,
  ): Promise<Activity> {
    return expectResponse(
      await this.authorized(`/v1/activities/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
      activitySchema,
    );
  }
  async deleteActivity(id: string): Promise<void> {
    await expectNoContent(
      await this.authorized(
        `/v1/activities/${encodeURIComponent(id)}?confirmation=DELETE`,
        {
          method: 'DELETE',
        },
      ),
    );
  }
  async initiatePhotoUpload(
    activityId: string,
    input: InitiatePhotoUploadRequest,
  ): Promise<SignedPhotoUpload> {
    return expectResponse(
      await this.authorized(
        `/v1/activities/${encodeURIComponent(activityId)}/photos/initiate`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
      signedPhotoUploadSchema,
    );
  }
  async reissuePhotoUpload(
    activityId: string,
    photoId: string,
  ): Promise<SignedPhotoUpload> {
    return expectResponse(
      await this.authorized(
        `/v1/activities/${encodeURIComponent(activityId)}/photos/${encodeURIComponent(photoId)}/reissue`,
        { method: 'POST' },
      ),
      signedPhotoUploadSchema,
    );
  }
  async uploadPhoto(
    signed: SignedPhotoUpload,
    localUri: string,
    expectedBytes: number,
  ): Promise<void> {
    const source = await this.fetcher(localUri);
    if (!source.ok) throw new Error('local_photo_unavailable');
    const blob = await source.blob();
    if (blob.size !== expectedBytes) throw new Error('local_photo_changed');
    const form = new FormData();
    for (const [name, value] of Object.entries(signed.form_fields))
      form.append(name, value);
    form.append('file', blob, 'photo');
    const response = await this.fetcher(signed.upload_url, {
      method: 'POST',
      body: form,
    });
    if (!response.ok)
      throw new ApiResponseError(response.status, 'photo_upload_failed');
  }
  async completePhotoUpload(
    activityId: string,
    photoId: string,
  ): Promise<PhotoCompleteResponse> {
    return expectResponse(
      await this.authorized(
        `/v1/activities/${encodeURIComponent(activityId)}/photos/${encodeURIComponent(photoId)}/complete`,
        { method: 'POST' },
      ),
      photoCompleteResponseSchema,
    );
  }
  async listPhotos(activityId: string) {
    return expectResponse(
      await this.authorized(
        `/v1/activities/${encodeURIComponent(activityId)}/photos`,
      ),
      activityPhotosSchema,
    );
  }
  async deletePhoto(activityId: string, photoId: string): Promise<void> {
    await expectNoContent(
      await this.authorized(
        `/v1/activities/${encodeURIComponent(activityId)}/photos/${encodeURIComponent(photoId)}`,
        { method: 'DELETE' },
      ),
    );
  }

  private async auth(path: string, payload: object): Promise<AuthResponse> {
    return expectResponse(await this.post(path, payload), authResponseSchema);
  }
  private post(path: string, payload: object): Promise<Response> {
    return this.fetcher(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }
  private authorized(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.session) throw new Error('Session coordinator is not attached.');
    return this.session.authorizedFetch(
      `${this.baseUrl}${path}`,
      {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init.headers },
      },
      this.fetcher,
    );
  }
}
