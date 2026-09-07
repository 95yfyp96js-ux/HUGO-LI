export interface IdentityScanResult {
  name: string;
  identityNumber: string;
  dateOfBirth: string;
  address: string | null;
  confidence: number;
  scannedAt: string;
}

/**
 * IdentityScanner is a READ-ONLY extraction step. Per spec §45 a scan must
 * never create a customer by itself — the API returns the parsed result and a
 * human confirms it before anything is written.
 */
export interface IdentityScanner {
  scan(payload?: { imageRef?: string }): Promise<IdentityScanResult>;
}

const SAMPLE_NAMES = ["林建宏", "陳怡君", "黃志明", "張淑芬", "李家豪"];

export class MockIdentityScanner implements IdentityScanner {
  async scan(): Promise<IdentityScanResult> {
    const index = Math.floor(Math.random() * SAMPLE_NAMES.length);
    const serial = Math.floor(10_000_000 + Math.random() * 89_999_999);
    return {
      name: SAMPLE_NAMES[index]!,
      identityNumber: `A1${serial}`,
      dateOfBirth: "1988-05-14",
      address: "台北市中正區重慶南路一段122號",
      confidence: 0.93,
      scannedAt: new Date().toISOString(),
    };
  }
}
