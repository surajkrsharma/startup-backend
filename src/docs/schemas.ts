/**
 * OpenAPI component schemas shared by every module's `@openapi` JSDoc blocks.
 * These describe the strict envelope and the most reused payloads.
 */
export const SERVER_SCHEMA: Record<string, any> = {
  SuccessResponse: {
    type: 'object',
    required: ['status', 'message', 'result'],
    properties: {
      status: { type: 'boolean', example: true },
      message: { type: 'string', example: 'Products fetched successfully.' },
      result: { type: 'object', description: 'Always an object, never null.' },
    },
  },
  ErrorResponse: {
    type: 'object',
    required: ['status', 'message', 'result'],
    properties: {
      status: { type: 'boolean', example: false },
      message: {
        type: 'string',
        example: 'Product not found. Error Code (NOT_FOUND)',
        description: 'Human message with the error code appended as `Error Code (CODE)`.',
      },
      result: { type: 'object', example: {}, description: 'Always an empty object on errors.' },
    },
  },
  EncryptedResponse: {
    type: 'object',
    properties: {
      encrypted: { type: 'boolean', example: true },
      iv: { type: 'string' },
      tag: { type: 'string' },
      data: { type: 'string' },
    },
    description:
      'Returned only when the request carried `x-encrypted: 1` and encryption is enabled.',
  },

  PaginatedResponse: {
    allOf: [
      { $ref: '#/components/schemas/SuccessResponse' },
      {
        type: 'object',
        properties: {
          result: {
            type: 'object',
            properties: {
              totalRecord: { type: 'integer', example: 145 },
              totalPage: { type: 'integer', example: 8 },
              currentPage: { type: 'integer', example: 1 },
              limit: { type: 'integer', example: 20 },
              hasNext: { type: 'boolean', example: true },
              hasPrevious: { type: 'boolean', example: false },
              nextPage: { type: 'integer', example: 2 },
              previousPage: { type: 'integer', example: 0 },
              list: {
                type: 'array',
                items: { type: 'object' },
                example: [{ productId: 'clx0000000000000000000000' }],
              },
            },
          },
        },
      },
    ],
  },

  PaginationMeta: {
    type: 'object',
    description: 'Present inside `result` only when an `xxxList` is returned, always first.',
    properties: {
      totalRecord: { type: 'integer', example: 145 },
      totalPage: { type: 'integer', example: 8 },
      currentPage: { type: 'integer', example: 1 },
      limit: { type: 'integer', example: 20 },
      hasNext: { type: 'boolean' },
      hasPrevious: { type: 'boolean' },
      nextPage: { type: 'integer', example: 2 },
      previousPage: { type: 'integer', example: 0 },
    },
  },

  WebhookProviderPayload: {
    type: 'object',
    description:
      'Provider-defined event payload. Only the fields below are read by the receiver; the rest is stored as-is.',
    additionalProperties: true,
    properties: {
      endpointId: {
        type: 'string',
        description: 'Webhook endpoint this event belongs to. Falls back to empty.',
        example: 'clx0000000000000000000000',
      },
      event: {
        type: 'string',
        description: 'Event name. Defaults to the provider.',
        example: 'payment.captured',
      },
      eventId: {
        type: 'string',
        description: 'Provider event id. Read from `eventId`, else from `id`.',
        example: 'evt_9f2a41c7',
      },
    },
  },

  RegisterCustomerRequest: {
    type: 'object',
    required: ['type', 'name', 'email', 'password', 'verificationToken'],
    description:
      'Step 3 of registration. `verificationToken` comes from POST /auth/register/verifyOtp and ' +
      'must have been issued for the `email` or `phone` sent here — presenting one issued for a ' +
      'different contact is rejected. It is single-use and short-lived. Only the contact the OTP ' +
      'proved is marked verified.',
    properties: {
      type: { type: 'string', enum: ['CUSTOMER'] },
      name: { type: 'string', example: 'Ravi Kumar' },
      email: { type: 'string', format: 'email', example: 'ravi@example.com' },
      phone: { type: 'string', example: '+919876543210' },
      password: { type: 'string', example: 'Secret@123' },
      verificationToken: { type: 'string', minLength: 32, example: '9f2a41c7…' },
    },
  },
  RegisterVendorRequest: {
    type: 'object',
    required: ['type', 'name', 'email', 'password', 'verificationToken', 'shopName'],
    properties: {
      type: { type: 'string', enum: ['VENDOR'] },
      name: { type: 'string', example: 'Ravi Kumar' },
      email: { type: 'string', format: 'email', example: 'ravi@example.com' },
      phone: { type: 'string', example: '+919876543210' },
      password: { type: 'string', example: 'Secret@123' },
      verificationToken: { type: 'string', minLength: 32, example: '9f2a41c7…' },
      shopName: { type: 'string', example: 'Ravi Store' },
      slug: { type: 'string', example: 'ravi-store' },
      description: { type: 'string' },
      gstNumber: { type: 'string' },
      panNumber: { type: 'string' },
      bankHolderName: { type: 'string' },
      bankAccountNo: { type: 'string' },
      bankIfsc: { type: 'string' },
      upiId: { type: 'string' },
    },
  },
  RegistrationSendOtpRequest: {
    type: 'object',
    required: ['identifier'],
    description:
      'Registration step 1. Returns the same shape whether or not the identifier is already ' +
      'taken, so it cannot be used to enumerate accounts.',
    properties: {
      identifier: { type: 'string', description: 'Email address or phone number.' },
      channel: { type: 'string', enum: ['EMAIL', 'SMS', 'BOTH'] },
    },
  },
  RegistrationVerifyOtpRequest: {
    type: 'object',
    required: ['identifier', 'otp'],
    description: 'Registration step 2. Returns a verificationToken; creates nothing.',
    properties: {
      identifier: { type: 'string' },
      otp: { type: 'string', minLength: 6, maxLength: 6, example: '123456' },
      channel: { type: 'string', enum: ['EMAIL', 'SMS', 'BOTH'] },
    },
  },
  VerificationTokenResponse: {
    allOf: [
      { $ref: '#/components/schemas/SuccessResponse' },
      {
        type: 'object',
        properties: {
          result: {
            type: 'object',
            properties: {
              verificationToken: { type: 'string' },
              expiresIn: { type: 'integer', example: 900 },
              identifier: { type: 'string' },
            },
          },
        },
      },
    ],
  },
  LoginVerifyOtpRequest: {
    type: 'object',
    required: ['identifier', 'otp'],
    description:
      'Final step of OTP login. Verifies the code and signs in for the identifier it was ' +
      'sent to, so the session cannot be pointed elsewhere. The code is single-use.',
    properties: {
      identifier: { type: 'string' },
      otp: { type: 'string', minLength: 6, maxLength: 6, example: '123456' },
      channel: { type: 'string', enum: ['EMAIL', 'SMS', 'BOTH'] },
    },
  },
  LoginRequest: {
    type: 'object',
    required: ['password'],
    description:
      'Password login only. For OTP login use POST /auth/sendOtp (`type` = LOGIN) followed by ' +
      'POST /auth/login/verifyOtp, which verifies the code and signs in. There is ' +
      'deliberately no `otp` or `type` field here — OTP used to be accepted on this endpoint ' +
      'with a client-chosen purpose, which let a password-reset code open a session.',
    properties: {
      email: { type: 'string', format: 'email' },
      phone: { type: 'string' },
      password: { type: 'string' },
    },
  },
  SendOtpRequest: {
    type: 'object',
    required: ['type', 'identifier'],
    properties: {
      type: {
        type: 'string',
        enum: [
          'REGISTER',
          'FORGOT_PASSWORD',
          'LOGIN',
          'CHANGE_PASSWORD',
          'PHONE_VERIFY',
          'EMAIL_VERIFY',
          'TWO_FA',
        ],
      },
      channel: { type: 'string', enum: ['EMAIL', 'SMS', 'BOTH'], default: 'BOTH' },
      identifier: { type: 'string', description: 'Email address or phone number.' },
    },
  },
  SessionResponse: {
    allOf: [
      { $ref: '#/components/schemas/SuccessResponse' },
      {
        type: 'object',
        properties: {
          result: {
            type: 'object',
            properties: {
              accessToken: { type: 'string' },
              expiresIn: { type: 'integer', example: 900 },
              twoFactorRequired: { type: 'boolean' },
              userData: { type: 'object' },
              vendorData: { type: 'object' },
              rolesList: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    ],
  },

  DeviceData: {
    type: 'object',
    properties: {
      deviceId: { type: 'string' },
      platform: { type: 'string', enum: ['ANDROID', 'IOS', 'WEB'] },
      appVersion: { type: 'string' },
      model: { type: 'string' },
      locale: { type: 'string' },
      timezone: { type: 'string' },
    },
  },
  PaginationQuery: {
    type: 'object',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      {
        name: 'limit',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      { name: 'sort', in: 'query', schema: { type: 'string', example: '-createdAt' } },
      { name: 'search', in: 'query', schema: { type: 'string' } },
      {
        name: 'fields',
        in: 'query',
        schema: { type: 'string', description: 'Comma separated whitelist.' },
      },
    ],
  },
  UserData: {
    type: 'object',
    properties: {
      userId: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      avatarUrl: { type: 'string' },
      isActive: { type: 'boolean' },
      isEmailVerified: { type: 'boolean' },
      isPhoneVerified: { type: 'boolean' },
      rolesList: { type: 'array', items: { type: 'string' } },
    },
  },
  AddressData: {
    type: 'object',
    properties: {
      addressId: { type: 'string' },
      fullName: { type: 'string' },
      phone: { type: 'string' },
      line1: { type: 'string' },
      line2: { type: 'string' },
      city: { type: 'string' },
      state: { type: 'string' },
      country: { type: 'string' },
      pincode: { type: 'string' },
      isDefault: { type: 'boolean' },
    },
  },
  ProductData: {
    type: 'object',
    properties: {
      productId: { type: 'string' },
      name: { type: 'string' },
      slug: { type: 'string' },
      price: { type: 'number' },
      stock: { type: 'integer' },
      isActive: { type: 'boolean' },
      categoryData: { type: 'object' },
      vendorData: { type: 'object' },
      imageList: { type: 'array', items: { type: 'string' } },
      reviewList: { type: 'array', items: { type: 'object' } },
    },
  },
  OrderData: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      orderNumber: { type: 'string' },
      status: {
        type: 'string',
        enum: [
          'PENDING',
          'PENDING_TOKEN',
          'CONFIRMED',
          'SHIPPED',
          'OUT_FOR_DELIVERY',
          'DELIVERED',
          'CANCELLED',
          'RETURNED',
        ],
      },
      total: { type: 'number' },
      tokenRequired: { type: 'boolean' },
      tokenAmount: { type: 'number' },
      addressData: { type: 'object' },
      itemList: { type: 'array', items: { type: 'object' } },
      subOrderList: { type: 'array', items: { type: 'object' } },
    },
  },
  WebhookSignatureHeader: {
    type: 'object',
    properties: {
      'x-signature': { type: 'string', description: 'HMAC SHA256 of the raw body.' },
    },
  },
};
