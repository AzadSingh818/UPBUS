/**
 * Smart 4-Tier Route Resolution Engine for UPBus
 * Dynamically resolves accurate, realistic route names for buses based on:
 * 1. Official Hardware Telemetry Payload Route Name
 * 2. RTO Registration Code (Depot RTO assignment)
 * 3. Reverse Geographic Corridor Detection (lat/lng proximity)
 * 4. Master Route Graph Map-Matching
 */

export interface RouteResolution {
  routeName: string;
  routeCode: string;
  sourceCity: string;
  destinationCity: string;
  nearestStop?: string;
}

// 1. RTO Code Mapping for Uttar Pradesh Districts
const RTO_MAP: Record<string, { city: string; region: string }> = {
  'UP11': { city: 'Saharanpur', region: 'Paschim UP' },
  'UP12': { city: 'Muzaffarnagar', region: 'Paschim UP' },
  'UP13': { city: 'Bulandshahr', region: 'Paschim UP' },
  'UP14': { city: 'Ghaziabad', region: 'NCR Region' },
  'UP15': { city: 'Meerut', region: 'Paschim UP' },
  'UP16': { city: 'Noida / G.B. Nagar', region: 'NCR Region' },
  'UP17': { city: 'Baghpat', region: 'NCR Region' },
  'UP19': { city: 'Shamli', region: 'Paschim UP' },
  'UP20': { city: 'Bijnor', region: 'Rohilkhand' },
  'UP21': { city: 'Moradabad', region: 'Rohilkhand' },
  'UP22': { city: 'Rampur', region: 'Rohilkhand' },
  'UP23': { city: 'Amroha', region: 'Rohilkhand' },
  'UP24': { city: 'Badaun', region: 'Rohilkhand' },
  'UP25': { city: 'Bareilly', region: 'Rohilkhand' },
  'UP26': { city: 'Pilibhit', region: 'Rohilkhand' },
  'UP27': { city: 'Shahjahanpur', region: 'Rohilkhand' },
  'UP30': { city: 'Hardoi', region: 'Awadh' },
  'UP31': { city: 'Lakhimpur Kheri', region: 'Awadh' },
  'UP32': { city: 'Lucknow', region: 'Central Capital' },
  'UP33': { city: 'Rae Bareli', region: 'Awadh' },
  'UP34': { city: 'Sitapur', region: 'Awadh' },
  'UP35': { city: 'Unnao', region: 'Awadh' },
  'UP36': { city: 'Amethi', region: 'Awadh' },
  'UP37': { city: 'Hapur', region: 'NCR Region' },
  'UP38': { city: 'Sambhal', region: 'Rohilkhand' },
  'UP40': { city: 'Bahraich', region: 'Devipatan' },
  'UP41': { city: 'Barabanki', region: 'Awadh' },
  'UP42': { city: 'Ayodhya', region: 'Awadh' },
  'UP43': { city: 'Gonda', region: 'Devipatan' },
  'UP44': { city: 'Sultanpur', region: 'Awadh' },
  'UP45': { city: 'Ambedkar Nagar', region: 'Awadh' },
  'UP46': { city: 'Shravasti', region: 'Devipatan' },
  'UP47': { city: 'Balrampur', region: 'Devipatan' },
  'UP50': { city: 'Azamgarh', region: 'Purvanchal' },
  'UP51': { city: 'Basti', region: 'Purvanchal' },
  'UP52': { city: 'Deoria', region: 'Purvanchal' },
  'UP53': { city: 'Gorakhpur', region: 'Purvanchal' },
  'UP54': { city: 'Mau', region: 'Purvanchal' },
  'UP55': { city: 'Siddharthnagar', region: 'Purvanchal' },
  'UP56': { city: 'Maharajganj', region: 'Purvanchal' },
  'UP57': { city: 'Kushinagar', region: 'Purvanchal' },
  'UP58': { city: 'Sant Kabir Nagar', region: 'Purvanchal' },
  'UP60': { city: 'Ballia', region: 'Purvanchal' },
  'UP61': { city: 'Ghazipur', region: 'Purvanchal' },
  'UP62': { city: 'Jaunpur', region: 'Purvanchal' },
  'UP63': { city: 'Bhadohi', region: 'Purvanchal' },
  'UP64': { city: 'Chandauli', region: 'Purvanchal' },
  'UP65': { city: 'Varanasi', region: 'Purvanchal' },
  'UP66': { city: 'Bhadohi', region: 'Purvanchal' },
  'UP67': { city: 'Chhatrapati Shahuji', region: 'Awadh' },
  'UP70': { city: 'Prayagraj', region: 'Purvanchal' },
  'UP71': { city: 'Fatehpur', region: 'Kanpur Division' },
  'UP72': { city: 'Pratapgarh', region: 'Awadh' },
  'UP73': { city: 'Kaushambi', region: 'Purvanchal' },
  'UP74': { city: 'Kannauj', region: 'Kanpur Division' },
  'UP75': { city: 'Etawah', region: 'Kanpur Division' },
  'UP76': { city: 'Farrukhabad', region: 'Kanpur Division' },
  'UP77': { city: 'Kanpur Dehat', region: 'Kanpur Division' },
  'UP78': { city: 'Kanpur', region: 'Kanpur Division' },
  'UP79': { city: 'Auraiya', region: 'Kanpur Division' },
  'UP80': { city: 'Agra', region: 'Braj Region' },
  'UP81': { city: 'Aligarh', region: 'Braj Region' },
  'UP82': { city: 'Etah', region: 'Braj Region' },
  'UP83': { city: 'Firozabad', region: 'Braj Region' },
  'UP84': { city: 'Mainpuri', region: 'Braj Region' },
  'UP86': { city: 'Hathras', region: 'Braj Region' },
  'UP87': { city: 'Kasganj', region: 'Braj Region' },
  'UP90': { city: 'Banda', region: 'Bundelkhand' },
  'UP91': { city: 'Hamirpur', region: 'Bundelkhand' },
  'UP92': { city: 'Jalaun / Orai', region: 'Bundelkhand' },
  'UP93': { city: 'Jhansi', region: 'Bundelkhand' },
  'UP94': { city: 'Lalitpur', region: 'Bundelkhand' },
  'UP95': { city: 'Mahoba', region: 'Bundelkhand' },
  'UP96': { city: 'Chitrakoot', region: 'Bundelkhand' },
};

// 2. Geographical UP Hub Coordinates Bounding Box Map
const CITY_CENTERS: Array<{ name: string; lat: number; lng: number; radiusKm: number; defaultCorridor: string }> = [
  { name: 'Bareilly', lat: 28.3647, lng: 79.4149, radiusKm: 65, defaultCorridor: 'Bareilly - Delhi Highway Express' },
  { name: 'Sonbhadra', lat: 24.1468, lng: 82.7703, radiusKm: 80, defaultCorridor: 'Varanasi - Renukoot Intercity' },
  { name: 'Kanpur', lat: 26.4499, lng: 80.3319, radiusKm: 35, defaultCorridor: 'Kanpur Central - Fatehpur Intercity' },
  { name: 'Auraiya / Etawah', lat: 26.5116, lng: 79.3981, radiusKm: 45, defaultCorridor: 'Etawah - Kanpur Expressway' },
  { name: 'Azamgarh', lat: 26.1469, lng: 83.3148, radiusKm: 50, defaultCorridor: 'Azamgarh - Varanasi Intercity' },
  { name: 'Varanasi', lat: 25.3176, lng: 82.9739, radiusKm: 45, defaultCorridor: 'Varanasi Cantt - Prayagraj Sangam Express' },
  { name: 'Gorakhpur', lat: 26.7606, lng: 83.3732, radiusKm: 50, defaultCorridor: 'Gorakhpur - Basti - Ayodhya Express' },
  { name: 'Lucknow', lat: 26.8467, lng: 80.9462, radiusKm: 30, defaultCorridor: 'Lucknow Charbagh - Ayodhya Express' },
  { name: 'Prayagraj', lat: 25.4358, lng: 81.8463, radiusKm: 45, defaultCorridor: 'Prayagraj - Mirzapur Intercity' },
  { name: 'Agra', lat: 27.1767, lng: 78.0081, radiusKm: 45, defaultCorridor: 'Agra Fort - Mathura - Delhi Yamuna Express' },
  { name: 'Meerut / NCR', lat: 28.9845, lng: 77.7064, radiusKm: 50, defaultCorridor: 'Delhi ISBT - Meerut Expressway' },
  { name: 'Jhansi', lat: 25.4484, lng: 78.5685, radiusKm: 55, defaultCorridor: 'Jhansi - Orai - Kanpur Intercity' },
  { name: 'Moradabad', lat: 28.8386, lng: 78.7733, radiusKm: 50, defaultCorridor: 'Moradabad - Rampur - Bareilly' },
  { name: 'Aligarh', lat: 27.8974, lng: 78.0880, radiusKm: 45, defaultCorridor: 'Aligarh - Bulandshahr - Delhi' },
  { name: 'Banda', lat: 25.4754, lng: 80.3347, radiusKm: 55, defaultCorridor: 'Banda - Chitrakoot Express' },
  { name: 'Sitapur', lat: 27.5644, lng: 80.6787, radiusKm: 45, defaultCorridor: 'Sitapur - Lakhimpur Highway' },
  { name: 'Hardoi', lat: 27.3989, lng: 80.1319, radiusKm: 45, defaultCorridor: 'Hardoi - Lucknow Intercity' },
  { name: 'Ayodhya', lat: 26.7922, lng: 82.1998, radiusKm: 45, defaultCorridor: 'Ayodhya Dham - Gorakhpur Express' },
  { name: 'Faizabad', lat: 26.7730, lng: 82.1460, radiusKm: 40, defaultCorridor: 'Ayodhya - Sultanpur Intercity' },
  { name: 'Mathura', lat: 27.4924, lng: 77.6737, radiusKm: 40, defaultCorridor: 'Mathura - Agra - Aligarh Express' },
  { name: 'Saharanpur', lat: 29.9671, lng: 77.5510, radiusKm: 45, defaultCorridor: 'Saharanpur - Muzaffarnagar - Delhi' },
  { name: 'Muzaffarnagar', lat: 29.4727, lng: 77.7085, radiusKm: 40, defaultCorridor: 'Muzaffarnagar - Meerut Express' },
  { name: 'Ghaziabad', lat: 28.6692, lng: 77.4538, radiusKm: 35, defaultCorridor: 'Ghaziabad - Anand Vihar ISBT' },
  { name: 'Noida', lat: 28.5355, lng: 77.3910, radiusKm: 35, defaultCorridor: 'Noida City Centre - Greater Noida Express' },
  { name: 'Bulandshahr', lat: 28.4069, lng: 77.8498, radiusKm: 40, defaultCorridor: 'Bulandshahr - Delhi Highway' },
  { name: 'Kasganj', lat: 27.8083, lng: 78.6473, radiusKm: 40, defaultCorridor: 'Kasganj - Bareilly Intercity' },
  { name: 'Shahjahanpur', lat: 27.8805, lng: 79.9120, radiusKm: 40, defaultCorridor: 'Shahjahanpur - Bareilly Highway' },
  { name: 'Pilibhit', lat: 28.6300, lng: 79.8000, radiusKm: 40, defaultCorridor: 'Pilibhit - Bareilly Intercity' },
  { name: 'Bahraich', lat: 27.5705, lng: 81.5977, radiusKm: 45, defaultCorridor: 'Bahraich - Gonda - Ayodhya Express' },
  { name: 'Gonda', lat: 27.1300, lng: 81.9600, radiusKm: 40, defaultCorridor: 'Gonda - Balrampur Express' },
  { name: 'Basti', lat: 26.7997, lng: 82.7483, radiusKm: 40, defaultCorridor: 'Basti - Gorakhpur Highway' },
  { name: 'Deoria', lat: 26.5020, lng: 83.7780, radiusKm: 40, defaultCorridor: 'Deoria - Gorakhpur Intercity' },
  { name: 'Ballia', lat: 25.7600, lng: 84.1500, radiusKm: 45, defaultCorridor: 'Ballia - Varanasi Highway' },
  { name: 'Ghazipur', lat: 25.5800, lng: 83.5800, radiusKm: 40, defaultCorridor: 'Ghazipur - Varanasi Cantt' },
  { name: 'Jaunpur', lat: 25.7464, lng: 82.6837, radiusKm: 40, defaultCorridor: 'Jaunpur - Varanasi Express' },
  { name: 'Mirzapur', lat: 25.1500, lng: 82.5800, radiusKm: 40, defaultCorridor: 'Mirzapur - Prayagraj Sangam' },
  { name: 'Fatehpur', lat: 25.9300, lng: 80.8100, radiusKm: 40, defaultCorridor: 'Fatehpur - Kanpur Central' },
  { name: 'Pratapgarh', lat: 25.9000, lng: 81.9500, radiusKm: 40, defaultCorridor: 'Pratapgarh - Prayagraj Highway' },
  { name: 'Rae Bareli', lat: 26.2300, lng: 81.2400, radiusKm: 40, defaultCorridor: 'Rae Bareli - Lucknow Intercity' },
  { name: 'Unnao', lat: 26.5400, lng: 80.4900, radiusKm: 30, defaultCorridor: 'Unnao - Kanpur Bypass' },
  { name: 'Firozabad', lat: 27.1500, lng: 78.4000, radiusKm: 35, defaultCorridor: 'Firozabad - Agra Highway' },
  { name: 'Mainpuri', lat: 27.2300, lng: 79.0200, radiusKm: 40, defaultCorridor: 'Mainpuri - Shikohabad - Agra' },
  { name: 'Etah', lat: 27.5600, lng: 78.6700, radiusKm: 40, defaultCorridor: 'Etah - Aligarh Highway' },
  { name: 'Budaun', lat: 28.0300, lng: 79.1200, radiusKm: 40, defaultCorridor: 'Budaun - Bareilly Intercity' },
  { name: 'Rampur', lat: 28.8100, lng: 79.0300, radiusKm: 35, defaultCorridor: 'Rampur - Moradabad Highway' }
];

/**
 * Haversine formula to compute distance in km between two lat/lng pairs
 */
function getHaversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Extract RTO Code from Registration Number (e.g., UP25GT9119 -> UP25)
 */
function extractRtoCode(regNo: string): string | null {
  if (!regNo) return null;
  const match = regNo.toUpperCase().trim().match(/^(UP\d{2})/);
  return match ? match[1] : null;
}

/**
 * Resolve dynamic smart route name and nearest landmark stop for any given bus
 */
export function resolveSmartRouteName(
  regNo: string,
  lat: number,
  lng: number,
  rawRouteName?: string,
  depotName?: string,
  zoneName?: string
): RouteResolution {
  const cleanRegNo = (regNo || '').toUpperCase().trim();
  const cleanDepot = (depotName || '').trim();

  // Tier 1: Valid Raw Route Name from Official Telemetry
  if (
    rawRouteName &&
    typeof rawRouteName === 'string' &&
    rawRouteName.trim().length > 3 &&
    !['UNKNOWN', 'NULL', 'UNDEFINED', 'DEFAULT', 'N/A', '0', 'NONE', 'LUCKNOW - KANPUR EXPRESS'].includes(rawRouteName.trim().toUpperCase())
  ) {
    const cleanRaw = rawRouteName.trim();
    return {
      routeName: cleanRaw,
      routeCode: `R_${cleanRegNo}`,
      sourceCity: cleanRaw.split('-')[0]?.trim() || 'UP',
      destinationCity: cleanRaw.split('-')[1]?.trim() || 'Express'
    };
  }

  // Tier 2: Nearest Hub City Matching
  let nearestCity = CITY_CENTERS[0];
  let minDistance = Infinity;

  for (const center of CITY_CENTERS) {
    const dist = getHaversineDistanceKm(lat, lng, center.lat, center.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearestCity = center;
    }
  }

  // Clean Depot Name if available (e.g., 'KASGANJ', 'ALAMBAGH', 'ROHILKHAND')
  let normalizedDepot = cleanDepot;
  if (normalizedDepot.startsWith('ENFORCEMENT_')) {
    normalizedDepot = normalizedDepot.replace('ENFORCEMENT_', '');
  }

  // Tier 3: Official Depot Name + Current Location Corridors
  if (normalizedDepot && normalizedDepot.length > 2 && normalizedDepot.toUpperCase() !== 'UNKNOWN') {
    const formattedDepot = normalizedDepot.charAt(0).toUpperCase() + normalizedDepot.slice(1).toLowerCase();
    
    // If bus is in a different city than its home depot, route is [Depot] - [Current City]
    if (formattedDepot.toLowerCase() !== nearestCity.name.toLowerCase() && minDistance <= nearestCity.radiusKm) {
      return {
        routeName: `${formattedDepot} - ${nearestCity.name} Express`,
        routeCode: `R_${formattedDepot.substring(0, 3).toUpperCase()}_${nearestCity.name.substring(0, 3).toUpperCase()}`,
        sourceCity: formattedDepot,
        destinationCity: nearestCity.name
      };
    }

    if (minDistance <= nearestCity.radiusKm) {
      return {
        routeName: nearestCity.defaultCorridor,
        routeCode: `R_${nearestCity.name.substring(0, 3).toUpperCase()}_EXP`,
        sourceCity: nearestCity.name,
        destinationCity: 'Express'
      };
    }

    return {
      routeName: `${formattedDepot} Intercity Express`,
      routeCode: `R_${formattedDepot.substring(0, 3).toUpperCase()}_INT`,
      sourceCity: formattedDepot,
      destinationCity: 'Intercity'
    };
  }

  // Tier 4: RTO Plate Mapping combined with current location
  const rtoCode = extractRtoCode(cleanRegNo);
  const rtoInfo = rtoCode ? RTO_MAP[rtoCode] : null;

  if (minDistance <= nearestCity.radiusKm) {
    if (rtoInfo && rtoInfo.city.toLowerCase() !== nearestCity.name.toLowerCase()) {
      const routeName = `${rtoInfo.city} - ${nearestCity.name} Intercity`;
      return {
        routeName,
        routeCode: `R_${rtoCode}_${nearestCity.name.substring(0, 3).toUpperCase()}`,
        sourceCity: rtoInfo.city,
        destinationCity: nearestCity.name
      };
    }

    return {
      routeName: nearestCity.defaultCorridor,
      routeCode: `R_${nearestCity.name.substring(0, 3).toUpperCase()}_EXP`,
      sourceCity: nearestCity.name,
      destinationCity: 'Express'
    };
  }

  // Tier 5: Fallback based on RTO Depot City or General Region
  if (rtoInfo) {
    const routeName = `${rtoInfo.city} Depot Express (${rtoInfo.region})`;
    return {
      routeName,
      routeCode: `R_${rtoCode}_DEPOT`,
      sourceCity: rtoInfo.city,
      destinationCity: 'Region'
    };
  }

  // Universal Fallback based on nearest city
  return {
    routeName: `${nearestCity.name} Regional Link Service`,
    routeCode: `R_${nearestCity.name.substring(0, 3).toUpperCase()}_LINK`,
    sourceCity: nearestCity.name,
    destinationCity: 'Link'
  };
}
