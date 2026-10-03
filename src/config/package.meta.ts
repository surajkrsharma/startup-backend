/* eslint-disable @typescript-eslint/no-var-requires */
import path from 'path';
import fs from 'fs';

interface PackageMeta {
  name: string;
  version: string;
  description: string;
}

const readPackageJson = (): PackageMeta => {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'package.json'),
    path.join(__dirname, '..', '..', 'package.json'),
    path.join(process.cwd(), 'package.json'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf8')) as PackageMeta;
      }
    } catch {
      /* try next candidate */
    }
  }

  return { name: 'projectname-api', version: '1.0.0', description: '' };
};

export const packageJson = readPackageJson();
