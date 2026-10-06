import { prisma } from '../../services/prisma.service';
import { logger } from '../../services/logger.service';
import { randomString, sha256 } from '../../utils/crypto';
import { AppError } from '../../utils/AppError';
import { ERROR } from '../../messages/error';
import { ERROR_CODE, HTTP_STATUS } from '../../constants/http';
import { VERIFICATION } from '../../config/verification.config';
import { OTP_CHANNEL, VerificationPurpose } from '../../constants/roles';
import { EMAIL_REGEX } from '../../constants/countries';
import { D } from '../../utils/defaults';
import { addMinutes } from '../../utils/dates';

export const normaliseIdentifier = (value: string): string => {
  const raw = D.str(value).trim();
  return EMAIL_REGEX.test(raw) ? raw.toLowerCase() : raw;
};

export const channelForIdentifier = (identifier: string): string =>
  EMAIL_REGEX.test(identifier) ? OTP_CHANNEL.EMAIL : OTP_CHANNEL.SMS;

export interface VerificationProof {
  identifier: string;
  channel: string;
}

export interface IssuedVerification {
  verificationToken: string;
  expiresIn: number;
}

const invalid = (): AppError =>
  new AppError(
    ERROR.AUTH.VERIFICATION_INVALID,
    HTTP_STATUS.UNAUTHORIZED,
    ERROR_CODE.VERIFICATION_INVALID,
  );

const mismatch = (): AppError =>
  new AppError(
    ERROR.AUTH.VERIFICATION_IDENTIFIER_MISMATCH,
    HTTP_STATUS.BAD_REQUEST,
    ERROR_CODE.VERIFICATION_IDENTIFIER_MISMATCH,
  );

export const issueVerification = async (
  purpose: VerificationPurpose,
  identifier: string,
  channel: string,
  userId?: string,
): Promise<IssuedVerification> => {
  const token = randomString(VERIFICATION.TOKEN_BYTES * 2);

  await prisma.authVerification.create({
    data: {
      tokenHash: sha256(token),
      purpose: purpose as any,
      identifier,
      channel: channel as any,
      userId: userId ?? null,
      expiresAt: addMinutes(VERIFICATION.TTL_MIN),
    },
  });

  return { verificationToken: token, expiresIn: VERIFICATION.TTL_MIN * 60 };
};

export const consumeVerification = async (
  verificationToken: string,
  purpose: VerificationPurpose,
): Promise<VerificationProof> => {
  const token = D.str(verificationToken);
  if (!token) throw invalid();

  const now = new Date();
  const tokenHash = sha256(token);

  const claimed = await prisma.authVerification.updateMany({
    where: {
      tokenHash,
      purpose: purpose as any,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });

  if (claimed.count === 0) {
    logger.warn({ purpose }, '[auth] verification token rejected (unknown, reused or expired)');
    throw invalid();
  }

  const record = await prisma.authVerification.findUnique({
    where: { tokenHash },
    select: { identifier: true, channel: true },
  });

  if (!record) throw invalid();

  return { identifier: record.identifier, channel: String(record.channel) };
};

export const consumeVerificationFor = async (
  verificationToken: string,
  purpose: VerificationPurpose,
  claimedIdentifiers: (string | undefined | null)[],
): Promise<VerificationProof> => {
  const claimed = claimedIdentifiers
    .map((value) => normaliseIdentifier(D.str(value)))
    .filter(Boolean);

  if (claimed.length) {
    const pending = await findPendingVerification(verificationToken, purpose);

    if (!pending) {
      logger.warn({ purpose }, '[auth] verification token rejected (unknown, reused or expired)');
      throw invalid();
    }

    if (!claimed.includes(pending.identifier)) throw mismatch();
  }

  return consumeVerification(verificationToken, purpose);
};

const findPendingVerification = async (
  verificationToken: string,
  purpose: VerificationPurpose,
): Promise<VerificationProof | null> => {
  const token = D.str(verificationToken);
  if (!token) return null;

  const record = await prisma.authVerification.findFirst({
    where: {
      tokenHash: sha256(token),
      purpose: purpose as any,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { identifier: true, channel: true },
  });

  if (!record) return null;

  return { identifier: record.identifier, channel: String(record.channel) };
};

export { invalid as verificationInvalidError, mismatch as verificationMismatchError };
