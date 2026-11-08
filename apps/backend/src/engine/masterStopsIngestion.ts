/**
 * Master Stops Ingestion & Quality Flagging Engine (Phase 1)
 * Parses 14,762 stops from Margdarshi raw dataset and structures them with:
 * - Easting = Longitude (76-84°), Northing = Latitude (23-32°)
 * - Strict quality classification: 'valid' | 'missing' | 'out_of_bounds'
 * - Preserves zero-coordinate stops as 'missing' without fake overwriting
 */

import * as fs from 'fs';
import * as path from 'path';

export interface MasterStopRecord {
  stopCode: number;
  name: string;
  adminAreaCode?: string;
  latitude: number | null;
  longitude: number | null;
  sourceQuality: 'valid' | 'missing' | 'out_of_bounds';
  rawEasting: number;
  rawNorthing: number;
}

export interface IngestionStats {
  totalProcessed: number;
  validWithCoords: number;
  missingCoords: number;
  outOfBoundsCoords: number;
}

export function processMasterStops(rawJsonPath: string): { stops: MasterStopRecord[]; stats: IngestionStats } {
  if (!fs.existsSync(rawJsonPath)) {
    throw new Error(`Raw stops file not found at ${rawJsonPath}`);
  }

  const rawData: any[] = JSON.parse(fs.readFileSync(rawJsonPath, 'utf8'));

  const stops: MasterStopRecord[] = [];
  const stats: IngestionStats = {
    totalProcessed: rawData.length,
    validWithCoords: 0,
    missingCoords: 0,
    outOfBoundsCoords: 0
  };

  for (const item of rawData) {
    const stopCode = Number(item.StopAreaCode);
    const name = (item.Name || '').trim();
    const adminAreaCode = (item.AdministrativeAreaCode || '').trim() || undefined;

    const easting = Number(item.Easting) || 0;
    const northing = Number(item.Northing) || 0;

    let latitude: number | null = null;
    let longitude: number | null = null;
    let quality: 'valid' | 'missing' | 'out_of_bounds' = 'missing';

    // In Indian Transit Standards & Margdarshi telemetry:
    // Easting = Longitude (UP is ~77.0 to ~84.5)
    // Northing = Latitude (UP is ~23.8 to ~31.5)
    if (easting === 0 && northing === 0) {
      quality = 'missing';
      stats.missingCoords++;
    } else {
      // Validate geographical bounding box of Uttar Pradesh and neighboring NCR/Punjab/Uttarakhand links
      const lat = northing;
      const lng = easting;

      if (lat >= 20.0 && lat <= 36.0 && lng >= 70.0 && lng <= 88.0) {
        latitude = Number(lat.toFixed(6));
        longitude = Number(lng.toFixed(6));
        quality = 'valid';
        stats.validWithCoords++;
      } else {
        latitude = Number(lat.toFixed(6));
        longitude = Number(lng.toFixed(6));
        quality = 'out_of_bounds';
        stats.outOfBoundsCoords++;
      }
    }

    stops.push({
      stopCode,
      name,
      adminAreaCode,
      latitude,
      longitude,
      sourceQuality: quality,
      rawEasting: easting,
      rawNorthing: northing
    });
  }

  return { stops, stats };
}

