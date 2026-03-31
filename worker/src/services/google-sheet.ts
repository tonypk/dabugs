import type { Env } from "../types";
import {
  getGoogleSheetCursor,
  setGoogleSheetCursor,
  insertFeedback,
} from "../db/queries";

interface GoogleSheetRow {
  project_id: string;
  description: string;
  email: string;
  screenshot_url: string;
}

/**
 * Create JWT for Google Service Account authentication using Web Crypto API
 */
async function createJWT(serviceAccountKey: string): Promise<string> {
  const keyData = JSON.parse(serviceAccountKey);
  const { private_key, client_email } = keyData;

  // Remove PEM header/footer and decode base64
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = private_key
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s/g, "");

  // Decode base64
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  // Import the private key
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  // Create JWT claims
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const claims = {
    iss: client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  // Base64url encode
  const base64url = (data: string): string => {
    return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const headerEncoded = base64url(JSON.stringify(header));
  const claimsEncoded = base64url(JSON.stringify(claims));
  const signatureInput = `${headerEncoded}.${claimsEncoded}`;

  // Sign
  const encoder = new TextEncoder();
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(signatureInput)
  );

  const signatureEncoded = base64url(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return `${signatureInput}.${signatureEncoded}`;
}

/**
 * Exchange JWT for access token
 */
async function getAccessToken(jwt: string): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json<{ access_token: string }>();
  return data.access_token;
}

/**
 * Read rows from Google Sheet
 */
async function readSheetRows(
  sheetId: string,
  range: string,
  token: string
): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to read sheet: ${error}`);
  }

  const data = await response.json<{ values?: string[][] }>();
  return data.values ?? [];
}

/**
 * Poll Google Sheet for new feedback submissions
 * Returns number of imported rows
 */
export async function pollGoogleSheet(env: Env): Promise<number> {
  // Skip if not configured
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY || !env.GOOGLE_SHEET_ID) {
    return 0;
  }

  try {
    // Get cursor
    const cursor = await getGoogleSheetCursor(env.DB);

    // Authenticate
    const jwt = await createJWT(env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const token = await getAccessToken(jwt);

    // Read rows starting from cursor+1
    // Assumes Sheet1 with columns A-D (Project ID, Description, Email, Screenshot URL)
    const range = `Sheet1!A${cursor + 1}:D`;
    const rows = await readSheetRows(env.GOOGLE_SHEET_ID, range, token);

    let imported = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = cursor + 1 + i;

      // Expected columns: A=Project ID, B=Description, C=Email, D=Screenshot URL
      const project_id = row[0]?.trim();
      const description = row[1]?.trim();
      const email = row[2]?.trim();
      const screenshot_url = row[3]?.trim();

      // Skip if missing required fields
      if (!project_id || !description) {
        console.warn(`Skipping row ${rowNumber}: missing project_id or description`);
        continue;
      }

      // Insert feedback
      const screenshot_urls = screenshot_url ? [screenshot_url] : undefined;

      await insertFeedback(env.DB, {
        project_id,
        source: "google_form",
        description,
        reporter_id: email,
        reporter_name: email,
        screenshot_urls,
      });

      imported++;
    }

    // Update cursor
    if (rows.length > 0) {
      const newCursor = cursor + rows.length;
      await setGoogleSheetCursor(env.DB, newCursor);
    }

    return imported;
  } catch (error) {
    console.error("Google Sheet poll error:", error);
    throw error;
  }
}
