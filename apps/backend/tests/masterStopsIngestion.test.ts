import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { processMasterStops } from '../src/engine/masterStopsIngestion';

describe('Phase 1: Master Stops Ingestion & Quality Flagging', () => {
  const rawPath = path.resolve(__dirname, '../src/db/margdarshi_raw_stops.json');

  it('should parse 14,762 stops from Margdarshi dataset', () => {
    const { stops, stats } = processMasterStops(rawPath);
    expect(stats.totalProcessed).toBe(14762);
    expect(stops.length).toBe(14762);
  });

  it('should correctly separate valid coordinates vs missing coordinates', () => {
    const { stats } = processMasterStops(rawPath);
    expect(stats.validWithCoords).toBeGreaterThan(3000);
    expect(stats.missingCoords).toBeGreaterThan(10000);
  });

  it('should keep latitude and longitude null for zero coordinate stops without fake overwriting', () => {
    const { stops } = processMasterStops(rawPath);
    const zeroStops = stops.filter(s => s.sourceQuality === 'missing');
    for (const s of zeroStops.slice(0, 50)) {
      expect(s.latitude).toBeNull();
      expect(s.longitude).toBeNull();
      expect(s.sourceQuality).toBe('missing');
    }
  });

  it('should accurately map Easting to Longitude and Northing to Latitude for valid stops', () => {
    const { stops } = processMasterStops(rawPath);
    const validStops = stops.filter(s => s.sourceQuality === 'valid');
    for (const s of validStops.slice(0, 50)) {
      expect(s.latitude).toBe(s.rawNorthing);
      expect(s.longitude).toBe(s.rawEasting);
      // UP latitude bounds 20-35, longitude bounds 70-88
      expect(s.latitude!).toBeGreaterThanOrEqual(20);
      expect(s.latitude!).toBeLessThanOrEqual(36);
      expect(s.longitude!).toBeGreaterThanOrEqual(70);
      expect(s.longitude!).toBeLessThanOrEqual(88);
    }
  });
});

