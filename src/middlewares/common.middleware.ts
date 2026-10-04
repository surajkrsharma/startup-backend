import type { RequestHandler } from 'express';
import { ApiResponse } from '../utils/ApiResponse';
import { ERROR } from '../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../constants/http';
import { getPaymentMethodsConfig } from '../services/settings.service';
import { isFeatureEnabled } from '../services/settings.service';
import { PAYMENT_METHOD } from '../constants/roles';
import { asyncHandler } from '../utils/asyncHandler';

export const notFoundHandler: RequestHandler = (req, res) =>
  ApiResponse.error(res, {
    statusCode: HTTP_STATUS.NOT_FOUND,
    message: ERROR.COMMON.NOT_FOUND,
    code: ERROR_CODE.NOT_FOUND,
  });

export const requireFeature = (featureKey: string): RequestHandler =>
  asyncHandler(async (req, res, next) => {
    const enabled = await isFeatureEnabled(featureKey, false);
    if (!enabled) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.UNPROCESSABLE,
        message: ERROR.SYSTEM.FEATURE_DISABLED,
        code: ERROR_CODE.FEATURE_DISABLED,
      });
    }
    return next();
  });

export const requirePaymentMethod = (method: keyof typeof PAYMENT_METHOD): RequestHandler =>
  asyncHandler(async (req, res, next) => {
    const config = await getPaymentMethodsConfig();
    const enabledMap = {
      COD: config.cod.enabled,
      UPI: config.upi.enabled,
      BANK: config.bank.enabled,
      CARD: true,
      NETBANKING: true,
      WALLET: await isFeatureEnabled('feature.wallet', false),
      RAZORPAY: false,
      STRIPE: false,
    } as Record<string, boolean>;

    if (!enabledMap[method]) {
      return ApiResponse.error(res, {
        statusCode: HTTP_STATUS.UNPROCESSABLE,
        message: ERROR.PAYMENT.METHOD_DISABLED,
        code: ERROR_CODE.VALIDATION_ERROR,
      });
    }

    return next();
  });
