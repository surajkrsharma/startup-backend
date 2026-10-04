import { Router } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { SUCCESS } from '../../messages/success';
import { APP } from '../../config/app.config';
import { packageJson } from '../../config/package.meta';

const router = Router();

router.get('/', (_req, res) =>
  ApiResponse.success(res, {
    message: SUCCESS.SYSTEM.VERSION_FETCHED,
    result: {
      apiVersion: APP.VERSION,
      prefix: APP.API_PREFIX,
      serverName: APP.SERVER_NAME,
      packageVersion: packageJson.version,
      nodeVersion: process.version,
      docs: `${APP.API_PREFIX}/docs`,
    },
  }),
);

export default router;
