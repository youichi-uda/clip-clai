import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import https from 'node:https';

const CONFIG_DIR = join(homedir(), '.clip-clai');
const LICENSE_FILE = join(CONFIG_DIR, 'license.json');
const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';
const PRODUCT_ID = 'i4M00crhVoWTrtSNVngeqA==';
const OFFLINE_GRACE_DAYS = 7;

interface LicenseCache {
  key: string;
  email: string;
  valid: boolean;
  lastVerified: string; // ISO date
  expiresAt: string | null;
}

interface GumroadVerifyResponse {
  success: boolean;
  purchase?: {
    email: string;
    license_key: string;
    subscription_ended_at: string | null;
    subscription_cancelled_at: string | null;
    subscription_failed_at: string | null;
  };
  message?: string;
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function readCache(): LicenseCache | null {
  try {
    const data = readFileSync(LICENSE_FILE, 'utf-8');
    return JSON.parse(data) as LicenseCache;
  } catch {
    return null;
  }
}

function writeCache(cache: LicenseCache): void {
  ensureConfigDir();
  writeFileSync(LICENSE_FILE, JSON.stringify(cache, null, 2));
}

function gumroadVerify(licenseKey: string): Promise<GumroadVerifyResponse> {
  return new Promise((resolve, reject) => {
    const postData = `product_id=${encodeURIComponent(PRODUCT_ID)}&license_key=${encodeURIComponent(licenseKey)}`;

    const req = https.request(
      GUMROAD_VERIFY_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Invalid response from Gumroad: ${body.slice(0, 200)}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Gumroad API timeout'));
    });
    req.write(postData);
    req.end();
  });
}

/**
 * Activate a license key. Verifies with Gumroad and caches the result.
 */
export async function activateLicense(licenseKey: string): Promise<{ success: boolean; message: string }> {
  try {
    const resp = await gumroadVerify(licenseKey);

    if (!resp.success || !resp.purchase) {
      return { success: false, message: resp.message ?? 'Invalid license key' };
    }

    const purchase = resp.purchase;

    // Check if subscription is still active
    if (purchase.subscription_ended_at || purchase.subscription_failed_at) {
      return { success: false, message: 'Subscription has expired or failed' };
    }

    const cache: LicenseCache = {
      key: licenseKey,
      email: purchase.email,
      valid: true,
      lastVerified: new Date().toISOString(),
      expiresAt: null,
    };

    writeCache(cache);
    return { success: true, message: `Activated for ${purchase.email}` };
  } catch (err) {
    return { success: false, message: `Verification failed: ${(err as Error).message}` };
  }
}

/**
 * Check if a valid Pro license exists.
 * Uses cached result with offline grace period.
 */
export async function checkLicense(): Promise<boolean> {
  const cache = readCache();
  if (!cache || !cache.valid || !cache.key) {
    return false;
  }

  const lastVerified = new Date(cache.lastVerified);
  const daysSinceVerify = (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60 * 24);

  // Within grace period, accept cached result
  if (daysSinceVerify < OFFLINE_GRACE_DAYS) {
    return true;
  }

  // Try to re-verify
  try {
    const resp = await gumroadVerify(cache.key);
    if (resp.success && resp.purchase) {
      if (!resp.purchase.subscription_ended_at && !resp.purchase.subscription_failed_at) {
        cache.lastVerified = new Date().toISOString();
        cache.valid = true;
        writeCache(cache);
        return true;
      }
    }
    // License no longer valid
    cache.valid = false;
    writeCache(cache);
    return false;
  } catch {
    // Network error - extend grace period
    if (daysSinceVerify < OFFLINE_GRACE_DAYS * 2) {
      return true;
    }
    return false;
  }
}

/**
 * Deactivate the current license.
 */
export function deactivateLicense(): void {
  ensureConfigDir();
  writeFileSync(LICENSE_FILE, JSON.stringify({ valid: false }, null, 2));
}

/**
 * Get current license status for display.
 */
export function getLicenseStatus(): { active: boolean; email?: string; lastVerified?: string } {
  const cache = readCache();
  if (!cache || !cache.valid) {
    return { active: false };
  }
  return {
    active: true,
    email: cache.email,
    lastVerified: cache.lastVerified,
  };
}

/**
 * Gate for Pro commands. Prints error and exits if no license.
 */
export async function requirePro(commandName: string): Promise<void> {
  // Allow bypassing in development/testing
  if (process.env.CLIP_CLAI_LICENSE_BYPASS === '1') {
    return;
  }

  const licensed = await checkLicense();
  if (!licensed) {
    console.error(`[Pro] "${commandName}" requires a clip-clai Pro license.`);
    console.error('');
    console.error('  Get a license: https://youichi-uda.gumroad.com/l/clip-clai-pro');
    console.error('  Activate:      clip-clai activate <license-key>');
    console.error('');
    process.exit(1);
  }
}
