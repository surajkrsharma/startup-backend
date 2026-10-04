import { Request, Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { ERROR } from '../../messages/error';
import { AppError } from '../../utils/AppError';
import { ERROR_CODE, HTTP_STATUS } from '../../constants/http';
import { asyncHandler } from '../../utils/asyncHandler';
import { JWT } from '../../config/jwt.config';
import { HEADER } from '../../config/app.config';
import { REGISTER_TYPE, OTP_TYPE } from '../../constants/roles';
import { DeviceContext } from './auth.types';
import * as authService from './auth.service';
import {
  serializeSession,
  serializeOtpResponse,
  serializeSessionDevice,
  serializeTwoFactor,
  serializeAvailability,
  serializeAuthUser,
} from './auth.serializer';

const deviceFrom = (req: Request, input?: any): DeviceContext =>
  ({
    deviceId: req.deviceId ?? '',
    platform: (input?.deviceData?.platform ?? req.device?.platform ?? 'WEB') as any,
    ip: req.ip ?? '',
    userAgent: req.headers['user-agent'] ?? '',
    sessionKey: req.sessionKey ?? '',
    appVersion: input?.deviceData?.appVersion ?? '',
  }) as DeviceContext;

const refreshFrom = (req: Request): string => {
  const fromCookie = (req as any).cookies?.[JWT.REFRESH_COOKIE_NAME];
  if (fromCookie) return String(fromCookie);
  return String(req.body?.refreshToken ?? '');
};

const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(JWT.REFRESH_COOKIE_NAME, token, JWT.REFRESH_COOKIE_OPTIONS);
};

const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(JWT.REFRESH_COOKIE_NAME, { ...JWT.REFRESH_COOKIE_OPTIONS, maxAge: undefined });
};

export const register = asyncHandler(async (req, res) => {
  const type = req.body.type as string;

  if (!Object.values(REGISTER_TYPE).includes(type as any)) {
    throw new AppError(
      ERROR.AUTH.INVALID_REGISTER_TYPE,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.INVALID_REGISTER_TYPE,
    );
  }

  if (type === REGISTER_TYPE.VENDOR && !req.body.shopName) {
    throw new AppError(
      ERROR.AUTH.VENDOR_DETAILS_REQUIRED,
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODE.VENDOR_DETAILS_REQUIRED,
    );
  }

  const device = deviceFrom(req, req.body);

  const result =
    type === REGISTER_TYPE.VENDOR
      ? await authService.registerVendor(req.body, device, req)
      : await authService.registerCustomer(req.body, device, req);

  setRefreshCookie(res, result.tokens.refreshToken);

  return ApiResponse.created(
    res,
    type === REGISTER_TYPE.VENDOR
      ? SUCCESS.AUTH.REGISTERED_VENDOR
      : SUCCESS.AUTH.REGISTERED_CUSTOMER,
    serializeSession(result.user, result.tokens),
  );
});

export const login = asyncHandler(async (req, res) => {
  const device = deviceFrom(req, req.body);

  const outcome = req.body.otp
    ? await authService.loginWithOtp(
        {
          identifier: req.body.email || req.body.phone,
          otp: req.body.otp,
          type: (req.body.type ?? OTP_TYPE.LOGIN) as any,
        },
        device,
        req,
      )
    : await authService.loginWithPassword(
        { email: req.body.email, phone: req.body.phone, password: req.body.password },
        device,
        req,
      );

  if (outcome.twoFactorRequired) {
    return ApiResponse.success(res, {
      message: ERROR.AUTH.TWO_FA_REQUIRED,
      result: {
        twoFactorRequired: true,
        twoFactorToken: outcome.twoFactorToken,
        expiresIn: outcome.tokens.expiresIn,
        userData: serializeAuthUser(outcome.user),
      },
    });
  }

  setRefreshCookie(res, outcome.tokens.refreshToken);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.LOGGED_IN,
    result: serializeSession(outcome.user, outcome.tokens),
  });
});

export const loginWithOtp = asyncHandler(async (req, res) => {
  const device = deviceFrom(req, req.body);
  const outcome = await authService.loginWithOtp(
    {
      identifier: req.body.email || req.body.phone,
      otp: req.body.otp,
      type: (req.body.type ?? OTP_TYPE.LOGIN) as any,
    },
    device,
    req,
  );

  setRefreshCookie(res, outcome.tokens.refreshToken);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.LOGGED_IN,
    result: serializeSession(outcome.user, outcome.tokens),
  });
});

export const refreshToken = asyncHandler(async (req, res) => {
  const token = refreshFrom(req);
  if (!token) {
    throw new AppError(
      ERROR.AUTH.MISSING_REFRESH_TOKEN,
      HTTP_STATUS.UNAUTHORIZED,
      ERROR_CODE.SESSION_EXPIRED,
    );
  }

  const device = deviceFrom(req, req.body);
  const result = await authService.rotateRefreshToken(token, device);

  setRefreshCookie(res, result.tokens.refreshToken);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.TOKEN_REFRESHED,
    result: serializeSession(result.user, result.tokens),
  });
});

export const logout = asyncHandler(async (req, res) => {
  const token = refreshFrom(req);
  if (token) await authService.logout(req.auth!.userId, token);
  clearRefreshCookie(res);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.LOGGED_OUT,
    result: { isLoggedOut: true },
  });
});

export const logoutAllDevices = asyncHandler(async (req, res) => {
  const revoked = await authService.logoutAllDevices(req.auth!.userId);
  clearRefreshCookie(res);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.LOGGED_OUT_ALL_DEVICES,
    result: { revokedTokenCount: revoked, isLoggedOut: true },
  });
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getCurrentUser(req.auth!.userId);
  if (!user) {
    throw new AppError(ERROR.USER.NOT_FOUND, HTTP_STATUS.NOT_FOUND, ERROR_CODE.NOT_FOUND);
  }

  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: {
      userData: serializeAuthUser(user),
      vendorData: user.vendorProfile
        ? {
            vendorId: user.vendorProfile.id,
            shopName: user.vendorProfile.shopName,
            slug: user.vendorProfile.slug,
            status: user.vendorProfile.status,
            commissionRate: user.vendorProfile.commissionRate,
          }
        : {},
      rolesList: [String(user.role)],
      socialProviderList: (user.socialAccounts ?? []).map((s: any) => String(s.provider)),
    },
  });
});

export const sendOtp = asyncHandler(async (req, res) => {
  const result = await authService.sendOtp(
    { type: req.body.type, channel: req.body.channel ?? 'BOTH', identifier: req.body.identifier },
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.OTP_SENT,
    result: serializeOtpResponse(result),
  });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  if (req.body.isLoginFlow) {
    const device = deviceFrom(req, req.body);
    const outcome = await authService.loginWithOtp(
      { identifier: req.body.identifier, otp: req.body.otp, type: req.body.type },
      device,
      req,
    );
    setRefreshCookie(res, outcome.tokens.refreshToken);
    return ApiResponse.success(res, {
      message: SUCCESS.AUTH.OTP_VERIFIED,
      result: serializeSession(outcome.user, outcome.tokens),
    });
  }

  await authService.consumeOtp(req.body.identifier, req.body.type, req.body.otp, req.body.channel);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.OTP_VERIFIED,
    result: { isVerified: true },
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const identifier = req.body.email || req.body.phone;
  const result = await authService.sendOtp(
    { type: OTP_TYPE.FORGOT_PASSWORD, channel: 'BOTH', identifier },
    req,
  );

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.OTP_SENT,
    result: serializeOtpResponse(result),
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  clearRefreshCookie(res);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.PASSWORD_RESET,
    result: { isReset: true },
  });
});

export const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(
    req.auth!.userId,
    req.body.currentPassword,
    req.body.newPassword,
    req.body.logoutOtherDevices !== false,
    req.body.otp,
  );
  clearRefreshCookie(res);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.PASSWORD_UPDATED,
    result: { isChanged: true },
  });
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const result = await authService.verifyContact(req.auth!.userId, req.body);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.EMAIL_VERIFIED,
    result: result,
  });
});

export const verifyPhone = asyncHandler(async (req, res) => {
  const result = await authService.verifyContact(req.auth!.userId, {
    ...req.body,
    channel: req.body.channel ?? 'SMS',
  });
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.PHONE_VERIFIED,
    result,
  });
});

export const enable2FA = asyncHandler(async (req, res) => {
  const result = await authService.enableTwoFactor(req.auth!.userId);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.TWO_FA_ENABLED,
    result: serializeTwoFactor({ isEnabled: true, ...result }),
  });
});

export const disable2FA = asyncHandler(async (req, res) => {
  await authService.disableTwoFactor(req.auth!.userId, req.body.otp);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.TWO_FA_DISABLED,
    result: serializeTwoFactor({ isEnabled: false }),
  });
});

export const verify2FA = asyncHandler(async (req, res) => {
  const device = deviceFrom(req, req.body);
  const identifier = req.body.identifier || req.body.email || req.body.phone;

  const outcome = await authService.verifyTwoFactor(identifier, req.body.otp, device);
  setRefreshCookie(res, outcome.tokens.refreshToken);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.OTP_VERIFIED,
    result: serializeSession(outcome.user, outcome.tokens),
  });
});

export const socialLogin = asyncHandler(async (req, res) => {
  const device = deviceFrom(req, req.body);
  const result = await authService.socialLogin(req.body, device);

  setRefreshCookie(res, result.tokens.refreshToken);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.LOGGED_IN,
    result: {
      ...serializeSession(result.user, result.tokens),
      isNewUser: result.isNewUser,
    },
  });
});

export const linkSocial = asyncHandler(async (req, res) => {
  await authService.linkSocial(req.auth!.userId, req.body);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.SOCIAL_LINKED,
    result: { provider: req.body.provider, isLinked: true },
  });
});

export const unlinkSocial = asyncHandler(async (req, res) => {
  await authService.unlinkSocial(req.auth!.userId, req.body.provider);
  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.SOCIAL_UNLINKED,
    result: { provider: req.body.provider, isLinked: false },
  });
});

export const checkAvailability = asyncHandler(async (req, res) => {
  const result = await authService.checkAvailability(req.body);
  return ApiResponse.success(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: serializeAvailability({
      ...result,
      isAvailable: !result.emailExists && !result.phoneExists,
    }),
  });
});

export const listSessions = asyncHandler(async (req, res) => {
  const rows = await authService.listSessions(req.auth!.userId, req.auth!.sessionKey ?? '');

  return ApiResponse.paginated(res, {
    message: SUCCESS.COMMON.FETCHED,
    result: { sessionList: rows.map(serializeSessionDevice) },
    totalRecord: rows.length,
    currentPage: 1,
    limit: rows.length || 1,
  });
});

export const revokeSession = asyncHandler(async (req, res) => {
  await authService.revokeSession(req.auth!.userId, req.params.id);

  return ApiResponse.success(res, {
    message: SUCCESS.AUTH.SESSION_REVOKED,
    result: { sessionId: req.params.id, isRevoked: true },
  });
});

export { HEADER };
