import { query } from '../db';

export interface CanonicalVehicleLocation {
  registrationNo: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  timestamp: Date;
  status: 'moving' | 'halted' | 'offline';
}

// All UP district + village stop coordinates
const STOPS: Record<string, { lat: number; lng: number }> = {
  LKO_CHARBAGH: { lat: 26.8325516, lng: 80.9205848 },  // Lucknow Charbagh Bus Stand
  LKO_ALAMBAGH: { lat: 26.8140101, lng: 80.9025123 },  // Alambagh Bus Terminal, Lucknow
  KAN_CENTRAL: { lat: 26.4504153, lng: 80.340218 },  // Kanpur Jhakarkati Bus Terminal
  DEL_ANAND_VIHAR: { lat: 28.6467533, lng: 77.3180037 },  // Anand Vihar ISBT, Delhi
  GZB_KAUSHAMBI: { lat: 28.6452857, lng: 77.3243429 },  // Kaushambi Depot, Ghaziabad
  AGRA_FORT: { lat: 27.1798258, lng: 78.0208223 },  // Agra Fort Bus Stand
  ISBT_AGRA: { lat: 27.2077482, lng: 77.9775114 },  // ISBT Agra
  VARANASI: { lat: 25.3287535, lng: 82.9901165 },  // Varanasi Bus Stand
  CIVIL_LINEPRY: { lat: 25.4487162, lng: 81.8385513 },  // Civil Lines Bus Stand, Prayagraj
  AYODHYA_DHAM: { lat: 26.7489176, lng: 82.157608 },  // Ayodhya Dham Bus Stand
  BAREILLY_SAT: { lat: 28.3512892, lng: 79.4394361 },  // Bareilly Satellite Bus Stand
  JHANSI: { lat: 25.445941, lng: 78.5896074 },  // Jhansi Bus Stand
  MATHURA: { lat: 27.4936228, lng: 77.6843655 },  // Mathura Bus Stand
  NOIDA_35: { lat: 28.5806152, lng: 77.3563031 },  // Noida Sector 35 Depot
  UNNAO: { lat: 26.5458, lng: 80.4907 },  // Unnao Bus Stand
  GZB_OLD: { lat: 28.6657, lng: 77.4265 },  // Old Ghaziabad Bus Stand
  MODINAGAR: { lat: 28.8354, lng: 77.5855 },  // Modinagar Bus Stand
  MRT_BHAISALI: { lat: 29.0018557, lng: 77.7679671 },  // Meerut Bhaisali Bus Stand
  SRE_DEPOT: { lat: 29.964, lng: 77.546 },  // Saharanpur Depot
  KAILASHPUR: { lat: 29.9922, lng: 77.5912 },  // Kailashpur Village
  GAGALHERI: { lat: 30.0163, lng: 77.6806 },  // Gagalheri Junction
  CHUTMALPUR: { lat: 30.0383, lng: 77.7478 },  // Chutmalpur Bus Station
  BEHAT: { lat: 30.1652, lng: 77.6081 },  // Behat Depot
  SHAKUMBHARI: { lat: 30.316, lng: 77.6433 },  // Shakumbhari Devi Mandir
  TAPRI: { lat: 29.9042, lng: 77.5752 },  // Tapri Junction
  RAMPUR_MANIHARAN: { lat: 29.8055, lng: 77.4475 },  // Rampur Maniharan
  NANAUTA: { lat: 29.7128, lng: 77.4206 },  // Nanauta Bus Stand
  NAGGAL: { lat: 29.8322, lng: 77.6083 },  // Naggal Village
  DEOBAND: { lat: 29.6967, lng: 77.6811 },  // Deoband Depot
  SARSAWA: { lat: 30.0161, lng: 77.4042 },  // Sarsawa Town
  NAKUR: { lat: 29.9198, lng: 77.3031 },  // Nakur Bus Stand
  GANGOH: { lat: 29.7738, lng: 77.2562 },  // Gangoh Bus Stand
  SHAMLI: { lat: 29.4489, lng: 77.3164 },  // Shamli Bus Stand
  MUZAFFARNAGAR: { lat: 29.4727, lng: 77.7085 },  // Muzaffarnagar Depot
  KHATAULI: { lat: 29.2811, lng: 77.7338 },  // Khatauli Bus Stop
  BAGPAT: { lat: 28.9452, lng: 77.2148 },  // Bagpat Bus Stand
  HAPUR: { lat: 28.729, lng: 77.7755 },  // Hapur Bus Stand
  BULANDSHAHR: { lat: 28.4071, lng: 77.8498 },  // Bulandshahr Bus Stand
  SIYANA: { lat: 28.6207, lng: 77.8657 },  // Siyana Bus Stop
  HATHRAS: { lat: 27.6038, lng: 78.0528 },  // Hathras Bus Stand
  ALIGARH: { lat: 27.8761, lng: 78.1358 },  // Aligarh Bus Stand
  KASGANJ: { lat: 27.809, lng: 78.6458 },  // Kasganj Bus Stand
  FIROZABAD: { lat: 27.1592, lng: 78.3957 },  // Firozabad Bus Stand
  TUNDLA: { lat: 27.2177, lng: 78.2349 },  // Tundla Bus Stop
  MAINPURI: { lat: 27.2355, lng: 79.0196 },  // Mainpuri Bus Stand
  ETAH: { lat: 27.5647, lng: 78.6687 },  // Etah Bus Stand
  ETAWAH: { lat: 26.7858, lng: 79.0129 },  // Etawah Bus Stand
  GARHMUKTESHWAR: { lat: 28.7899, lng: 78.1085 },  // Garhmukteshwar Bus Stop
  BIJNOR: { lat: 29.3716, lng: 78.1361 },  // Bijnor Bus Stand
  NAJIBABAD: { lat: 29.6135, lng: 78.3432 },  // Najibabad Bus Stand
  AMROHA: { lat: 28.9048, lng: 78.4672 },  // Amroha Bus Stand
  MORADABAD: { lat: 28.8382, lng: 78.7762 },  // Moradabad Depot
  CHANDPUR: { lat: 29.1219, lng: 78.2718 },  // Chandpur Bus Stop
  RAMPUR: { lat: 28.8097, lng: 79.0259 },  // Rampur Bus Stand
  BILASPUR: { lat: 28.9892, lng: 78.8713 },  // Bilaspur Bus Stop
  BUDAUN: { lat: 28.0383, lng: 79.1273 },  // Budaun Bus Stand
  SHAHJAHANPUR: { lat: 27.8847, lng: 79.9078 },  // Shahjahanpur Bus Stand
  SHAHABAD: { lat: 27.6462, lng: 79.9434 },  // Shahabad Bus Stop
  PILIBHIT: { lat: 28.6258, lng: 79.8034 },  // Pilibhit Bus Stand
  BISALPUR: { lat: 28.2922, lng: 79.8175 },  // Bisalpur Bus Stop
  LAKHIMPUR: { lat: 27.9484, lng: 80.7817 },  // Lakhimpur Bus Stand
  SITAPUR: { lat: 27.5703, lng: 80.6827 },  // Sitapur Bus Stand
  BISWAN: { lat: 27.4917, lng: 80.9621 },  // Biswan Bus Stop
  HARDOI: { lat: 27.3961, lng: 80.1319 },  // Hardoi Bus Stand
  SANDILA: { lat: 27.0709, lng: 80.5165 },  // Sandila Bus Stop
  RAEBARELI: { lat: 26.2362, lng: 81.2416 },  // Raebareli Bus Stand
  SALON: { lat: 26.0037, lng: 81.204 },  // Salon Bus Stop
  BARABANKI: { lat: 26.9255, lng: 81.1846 },  // Barabanki Bus Stand
  FATEHPUR: { lat: 25.9298, lng: 80.813 },  // Fatehpur Bus Stand
  FARRUKHABAD: { lat: 27.3928, lng: 79.5818 },  // Farrukhabad Bus Stand
  KANNAUJ: { lat: 27.0553, lng: 79.9213 },  // Kannauj Bus Stand
  AURAIYA: { lat: 26.4653, lng: 79.5126 },  // Auraiya Bus Stand
  KANPUR_DEHAT: { lat: 26.4239, lng: 79.9611 },  // Kanpur Dehat Bus Stand
  ORAI: { lat: 25.9797, lng: 79.4605 },  // Orai Bus Stand
  HAMIRPUR: { lat: 25.9563, lng: 80.158 },  // Hamirpur Bus Stand
  JHINJHAK: { lat: 26.5551, lng: 79.7374 },  // Jhinjhak Bus Stop
  KANPUR_NT: { lat: 26.52, lng: 80.22 },  // Kanpur North Bus Stop
  PRATAPGARH: { lat: 25.8977, lng: 81.9869 },  // Pratapgarh Bus Stand
  SULTANPUR: { lat: 26.2625, lng: 82.0723 },  // Sultanpur Bus Stand
  AMETHI: { lat: 26.1543, lng: 81.8199 },  // Amethi Bus Stand
  AMBEDKAR_NGR: { lat: 26.4177, lng: 82.5382 },  // Ambedkar Nagar Bus Stand
  JAUNPUR: { lat: 25.746, lng: 82.6842 },  // Jaunpur Bus Stand
  KERAKAT: { lat: 25.8883, lng: 82.8503 },  // Kerakat Bus Stop
  AZAMGARH: { lat: 26.0678, lng: 83.184 },  // Azamgarh Depot
  MAU: { lat: 25.9413, lng: 83.5561 },  // Mau Bus Stand
  GHAZIPUR: { lat: 25.5781, lng: 83.5815 },  // Ghazipur Bus Stand
  BALLIA: { lat: 25.7577, lng: 84.1487 },  // Ballia Bus Stand
  CHANDAULI: { lat: 25.2706, lng: 83.2696 },  // Chandauli Bus Stand
  MIRZAPUR: { lat: 25.146, lng: 82.5691 },  // Mirzapur Bus Stand
  ROBERTSGANJ: { lat: 24.689, lng: 83.0598 },  // Robertsganj Bus Stand
  BHADOHI: { lat: 25.3824, lng: 82.5684 },  // Bhadohi Bus Stand
  GORAKHPUR: { lat: 26.6678, lng: 83.3642 },  // Gorakhpur Depot
  MAHARAJGANJ: { lat: 27.1404, lng: 83.5575 },  // Maharajganj Bus Stand
  KUSHINAGAR: { lat: 26.7319, lng: 83.8888 },  // Kushinagar Bus Stand
  DEORIA: { lat: 26.5033, lng: 83.7831 },  // Deoria Bus Stand
  BASTI: { lat: 26.7953, lng: 82.7158 },  // Basti Bus Stand
  SIDDHARTHNAGAR: { lat: 27.2966, lng: 83.0936 },  // Siddharthnagar Bus Stand
  SANT_KABIR: { lat: 26.7895, lng: 83.0653 },  // Sant Kabir Nagar Bus Stand
  GONDA: { lat: 27.13, lng: 81.969 },  // Gonda Bus Stand
  BAHRAICH: { lat: 27.5742, lng: 81.5938 },  // Bahraich Bus Stand
  SHRAVASTI: { lat: 27.7164, lng: 81.8944 },  // Shravasti Bus Stand
  BALRAMPUR: { lat: 27.4258, lng: 82.1785 },  // Balrampur Bus Stand
  KAUSHAMBI: { lat: 25.5393, lng: 81.3724 },  // Kaushambi Bus Stand
  TANDA: { lat: 26.5606, lng: 82.6619 },  // Tanda Bus Stop
  LALITPUR: { lat: 24.6896, lng: 78.4124 },  // Lalitpur Bus Stand
  BANDA: { lat: 25.4786, lng: 80.3345 },  // Banda Bus Stand
  CHITRAKOOT: { lat: 25.1939, lng: 80.8776 },  // Chitrakoot Bus Stand
  MAHOBA: { lat: 25.2921, lng: 79.8728 },  // Mahoba Bus Stand
  RATH: { lat: 25.5853, lng: 79.5628 },  // Rath Bus Stop
  PHANDPURI: { lat: 29.93, lng: 77.45 },  // Phandpuri
  KHERA_AFGAN: { lat: 29.8943, lng: 77.3718 },  // Khera Afgan
  AMBEHTA_PEER: { lat: 29.873, lng: 77.3411 },  // Ambehta Peer
  VIL_200_KASBA: { lat: 26.6799, lng: 80.6966 },  // Kasba (Village)
  VIL_201_KASBA: { lat: 26.4981, lng: 80.4155 },  // Kasba (Village)
  VIL_202_KASBA: { lat: 28.6555, lng: 77.3754 },  // Kasba (Village)
  VIL_203_KASBA: { lat: 28.7506, lng: 77.506 },  // Kasba (Village)
  VIL_204_KASBA: { lat: 28.9186, lng: 77.6767 },  // Kasba (Village)
  VIL_205_KASBA: { lat: 26.7815, lng: 81.5301 },  // Kasba (Village)
  VIL_206_KASBA: { lat: 26.0388, lng: 82.5739 },  // Kasba (Village)
  VIL_207_KASBA: { lat: 27.8942, lng: 77.6669 },  // Kasba (Village)
  VIL_208_KASBA: { lat: 25.3887, lng: 82.4143 },  // Kasba (Village)
  VIL_209_KASBA: { lat: 26.3268, lng: 78.2836 },  // Kasba (Village)
  VIL_210_KASBA: { lat: 27.3507, lng: 77.8309 },  // Kasba (Village)
  VIL_211_KASBA: { lat: 30.1017, lng: 77.6779 },  // Kasba (Village)
  VIL_212_KASBA: { lat: 30.2406, lng: 77.6257 },  // Kasba (Village)
  VIL_213_KASBA: { lat: 29.8548, lng: 77.5113 },  // Kasba (Village)
  VIL_214_KASBA: { lat: 29.7725, lng: 77.5144 },  // Kasba (Village)
  VIL_215_KASBA: { lat: 29.7645, lng: 77.6447 },  // Kasba (Village)
  VIL_216_KASBA: { lat: 29.8468, lng: 77.2797 },  // Kasba (Village)
  VIL_217_KASBA: { lat: 30.2406, lng: 77.6257 },  // Kasba (Village)
  VIL_218_KASBA: { lat: 30.1017, lng: 77.6779 },  // Kasba (Village)
  VIL_219_KASBA: { lat: 29.7645, lng: 77.6447 },  // Kasba (Village)
  VIL_220_KASBA: { lat: 29.7725, lng: 77.5144 },  // Kasba (Village)
  VIL_221_KASBA: { lat: 29.8548, lng: 77.5113 },  // Kasba (Village)
  VIL_222_KASBA: { lat: 29.8468, lng: 77.2797 },  // Kasba (Village)
  VIL_223_KASBA: { lat: 29.7064, lng: 77.4312 },  // Kasba (Village)
  VIL_224_KASBA: { lat: 29.4608, lng: 77.5125 },  // Kasba (Village)
  VIL_225_KASBA: { lat: 29.3769, lng: 77.7211 },  // Kasba (Village)
  VIL_226_KASBA: { lat: 29.1415, lng: 77.7509 },  // Kasba (Village)
  VIL_227_KASBA: { lat: 28.9186, lng: 77.6767 },  // Kasba (Village)
  VIL_228_KASBA: { lat: 28.7506, lng: 77.506 },  // Kasba (Village)
  VIL_229_KASBA: { lat: 28.6555, lng: 77.3754 },  // Kasba (Village)
  VIL_230_KASBA: { lat: 28.8654, lng: 77.7717 },  // Kasba (Village)
  VIL_231_KASBA: { lat: 28.6748, lng: 77.8206 },  // Kasba (Village)
  VIL_232_KASBA: { lat: 28.5139, lng: 77.8578 },  // Kasba (Village)
  VIL_233_KASBA: { lat: 28.1416, lng: 77.9928 },  // Kasba (Village)
  VIL_234_KASBA: { lat: 28.7176, lng: 77.7164 },  // Kasba (Village)
  VIL_235_KASBA: { lat: 28.5985, lng: 77.9792 },  // Kasba (Village)
  VIL_236_KASBA: { lat: 27.74, lng: 78.0943 },  // Kasba (Village)
  VIL_237_KASBA: { lat: 27.5487, lng: 77.8686 },  // Kasba (Village)
  VIL_238_KASBA: { lat: 27.3507, lng: 77.8309 },  // Kasba (Village)
  VIL_239_KASBA: { lat: 27.2127, lng: 78.1062 },  // Kasba (Village)
  VIL_240_KASBA: { lat: 27.1884, lng: 78.3153 },  // Kasba (Village)
  VIL_241_KASBA: { lat: 27.1974, lng: 78.7077 },  // Kasba (Village)
  VIL_242_KASBA: { lat: 27.0106, lng: 79.0162 },  // Kasba (Village)
  VIL_243_KASBA: { lat: 26.6704, lng: 79.3751 },  // Kasba (Village)
  VIL_244_KASBA: { lat: 26.5028, lng: 80.0388 },  // Kasba (Village)
  VIL_245_KASBA: { lat: 27.7204, lng: 78.4023 },  // Kasba (Village)
  VIL_246_KASBA: { lat: 27.6868, lng: 78.6573 },  // Kasba (Village)
  VIL_247_KASBA: { lat: 29.7888, lng: 77.9446 },  // Kasba (Village)
  VIL_248_KASBA: { lat: 29.4926, lng: 78.2396 },  // Kasba (Village)
  VIL_249_KASBA: { lat: 29.2467, lng: 78.2039 },  // Kasba (Village)
  VIL_250_KASBA: { lat: 28.98, lng: 78.524 },  // Kasba (Village)
  VIL_251_KASBA: { lat: 28.9137, lng: 78.8238 },  // Kasba (Village)
  VIL_252_KASBA: { lat: 28.8995, lng: 78.9486 },  // Kasba (Village)
  VIL_253_KASBA: { lat: 28.5805, lng: 79.2327 },  // Kasba (Village)
  VIL_254_KASBA: { lat: 28.3217, lng: 79.6285 },  // Kasba (Village)
  VIL_255_KASBA: { lat: 28.459, lng: 79.8105 },  // Kasba (Village)
  VIL_256_KASBA: { lat: 28.2871, lng: 80.2926 },  // Kasba (Village)
  VIL_257_KASBA: { lat: 27.7593, lng: 80.7322 },  // Kasba (Village)
  VIL_258_KASBA: { lat: 28.1948, lng: 79.2834 },  // Kasba (Village)
  VIL_259_KASBA: { lat: 28.118, lng: 79.6736 },  // Kasba (Village)
  VIL_260_KASBA: { lat: 27.7655, lng: 79.9256 },  // Kasba (Village)
  VIL_261_KASBA: { lat: 27.5211, lng: 80.0376 },  // Kasba (Village)
  VIL_262_KASBA: { lat: 27.2335, lng: 80.3242 },  // Kasba (Village)
  VIL_263_KASBA: { lat: 26.9517, lng: 80.7185 },  // Kasba (Village)
};

function interpolatePath(stopsList: { lat: number; lng: number }[], stepsPerSegment = 5): { lat: number; lng: number }[] {
  const fullPath: { lat: number; lng: number }[] = [];
  for (let i = 0; i < stopsList.length - 1; i++) {
    const p1 = stopsList[i]; const p2 = stopsList[i + 1];
    for (let step = 0; step < stepsPerSegment; step++) {
      const fraction = step / stepsPerSegment;
      fullPath.push({ lat: p1.lat + (p2.lat - p1.lat) * fraction, lng: p1.lng + (p2.lng - p1.lng) * fraction });
    }
  }
  fullPath.push(stopsList[stopsList.length - 1]);
  return fullPath;
}

// Route path arrays (interpolated GPS polylines)
const PATH_R_LKO_KAN = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.LKO_ALAMBAGH, STOPS.VIL_200_KASBA, STOPS.UNNAO, STOPS.VIL_201_KASBA, STOPS.KAN_CENTRAL], 3);
const PATH_R_DEL_MRT = interpolatePath([STOPS.DEL_ANAND_VIHAR, STOPS.GZB_KAUSHAMBI, STOPS.VIL_202_KASBA, STOPS.GZB_OLD, STOPS.VIL_203_KASBA, STOPS.MODINAGAR, STOPS.VIL_204_KASBA, STOPS.MRT_BHAISALI], 3);
const PATH_R_LKO_VNS = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.LKO_ALAMBAGH, STOPS.VIL_205_KASBA, STOPS.AYODHYA_DHAM, STOPS.VIL_206_KASBA, STOPS.VARANASI], 3);
const PATH_R_DEL_AGR = interpolatePath([STOPS.DEL_ANAND_VIHAR, STOPS.GZB_KAUSHAMBI, STOPS.NOIDA_35, STOPS.VIL_207_KASBA, STOPS.ISBT_AGRA], 3);
const PATH_R_VNS_PRY = interpolatePath([STOPS.VARANASI, STOPS.VIL_208_KASBA, STOPS.CIVIL_LINEPRY], 4);
const PATH_R_JHN_MTH = interpolatePath([STOPS.JHANSI, STOPS.VIL_209_KASBA, STOPS.ISBT_AGRA, STOPS.VIL_210_KASBA, STOPS.MATHURA], 3);
const PATH_R_SRE_BEH_SHK = interpolatePath([STOPS.SRE_DEPOT, STOPS.KAILASHPUR, STOPS.GAGALHERI, STOPS.CHUTMALPUR, STOPS.VIL_211_KASBA, STOPS.BEHAT, STOPS.VIL_212_KASBA, STOPS.SHAKUMBHARI], 3);
const PATH_R_SRE_RAM_NAN_DEO = interpolatePath([STOPS.SRE_DEPOT, STOPS.TAPRI, STOPS.VIL_213_KASBA, STOPS.RAMPUR_MANIHARAN, STOPS.NANAUTA, STOPS.VIL_214_KASBA, STOPS.NAGGAL, STOPS.VIL_215_KASBA, STOPS.DEOBAND], 3);
const PATH_R_SRE_PHA_NAK_GAN = interpolatePath([STOPS.SRE_DEPOT, STOPS.PHANDPURI, STOPS.KHERA_AFGAN, STOPS.NAKUR, STOPS.VIL_216_KASBA, STOPS.GANGOH], 3);
const PATH_R_SHK_BEH_SRE = interpolatePath([STOPS.SHAKUMBHARI, STOPS.VIL_217_KASBA, STOPS.BEHAT, STOPS.VIL_218_KASBA, STOPS.CHUTMALPUR, STOPS.GAGALHERI, STOPS.KAILASHPUR, STOPS.SRE_DEPOT], 3);
const PATH_R_DEO_NAN_RAM_SRE = interpolatePath([STOPS.DEOBAND, STOPS.VIL_219_KASBA, STOPS.NAGGAL, STOPS.VIL_220_KASBA, STOPS.NANAUTA, STOPS.RAMPUR_MANIHARAN, STOPS.VIL_221_KASBA, STOPS.TAPRI, STOPS.SRE_DEPOT], 3);
const PATH_R_GAN_NAK_PHA_SRE = interpolatePath([STOPS.GANGOH, STOPS.VIL_222_KASBA, STOPS.NAKUR, STOPS.KHERA_AFGAN, STOPS.PHANDPURI, STOPS.SRE_DEPOT], 3);
const PATH_R_SRE_MZN = interpolatePath([STOPS.SRE_DEPOT, STOPS.VIL_223_KASBA, STOPS.SHAMLI, STOPS.VIL_224_KASBA, STOPS.MUZAFFARNAGAR], 3);
const PATH_R_MZN_MRT = interpolatePath([STOPS.MUZAFFARNAGAR, STOPS.VIL_225_KASBA, STOPS.KHATAULI, STOPS.VIL_226_KASBA, STOPS.MRT_BHAISALI], 3);
const PATH_R_MRT_DEL = interpolatePath([STOPS.MRT_BHAISALI, STOPS.VIL_227_KASBA, STOPS.MODINAGAR, STOPS.VIL_228_KASBA, STOPS.GZB_OLD, STOPS.VIL_229_KASBA, STOPS.GZB_KAUSHAMBI, STOPS.DEL_ANAND_VIHAR], 3);
const PATH_R_MRT_HPR = interpolatePath([STOPS.MRT_BHAISALI, STOPS.VIL_230_KASBA, STOPS.HAPUR], 4);
const PATH_R_HPR_ALG = interpolatePath([STOPS.HAPUR, STOPS.VIL_231_KASBA, STOPS.SIYANA, STOPS.VIL_232_KASBA, STOPS.BULANDSHAHR, STOPS.VIL_233_KASBA, STOPS.ALIGARH], 3);
const PATH_R_GZB_BLS = interpolatePath([STOPS.GZB_KAUSHAMBI, STOPS.VIL_234_KASBA, STOPS.GARHMUKTESHWAR, STOPS.VIL_235_KASBA, STOPS.BULANDSHAHR], 3);
const PATH_R_ALG_AGR = interpolatePath([STOPS.ALIGARH, STOPS.VIL_236_KASBA, STOPS.HATHRAS, STOPS.VIL_237_KASBA, STOPS.MATHURA, STOPS.VIL_238_KASBA, STOPS.ISBT_AGRA], 3);
const PATH_R_AGR_FZB = interpolatePath([STOPS.ISBT_AGRA, STOPS.VIL_239_KASBA, STOPS.TUNDLA, STOPS.VIL_240_KASBA, STOPS.FIROZABAD], 3);
const PATH_R_FZB_MPR = interpolatePath([STOPS.FIROZABAD, STOPS.VIL_241_KASBA, STOPS.MAINPURI], 4);
const PATH_R_MPR_ETW = interpolatePath([STOPS.MAINPURI, STOPS.VIL_242_KASBA, STOPS.ETAWAH], 4);
const PATH_R_ETW_KAN = interpolatePath([STOPS.ETAWAH, STOPS.VIL_243_KASBA, STOPS.JHINJHAK, STOPS.VIL_244_KASBA, STOPS.KAN_CENTRAL], 3);
const PATH_R_ALG_KSG = interpolatePath([STOPS.ALIGARH, STOPS.VIL_245_KASBA, STOPS.ETAH, STOPS.VIL_246_KASBA, STOPS.KASGANJ], 3);
const PATH_R_SRE_BJN = interpolatePath([STOPS.SRE_DEPOT, STOPS.VIL_247_KASBA, STOPS.NAJIBABAD, STOPS.VIL_248_KASBA, STOPS.BIJNOR, STOPS.VIL_249_KASBA, STOPS.CHANDPUR, STOPS.VIL_250_KASBA, STOPS.MORADABAD], 3);
const PATH_R_MRD_BLY = interpolatePath([STOPS.MORADABAD, STOPS.VIL_251_KASBA, STOPS.BILASPUR, STOPS.VIL_252_KASBA, STOPS.RAMPUR, STOPS.VIL_253_KASBA, STOPS.BAREILLY_SAT], 3);
const PATH_R_BLY_PLB = interpolatePath([STOPS.BAREILLY_SAT, STOPS.VIL_254_KASBA, STOPS.BISALPUR, STOPS.VIL_255_KASBA, STOPS.PILIBHIT], 3);
const PATH_R_PLB_LKH = interpolatePath([STOPS.PILIBHIT, STOPS.VIL_256_KASBA, STOPS.LAKHIMPUR, STOPS.VIL_257_KASBA, STOPS.SITAPUR], 3);
const PATH_R_BLY_BDN = interpolatePath([STOPS.BAREILLY_SAT, STOPS.VIL_258_KASBA, STOPS.BUDAUN], 4);
const PATH_R_BLY_LKO = interpolatePath([STOPS.BAREILLY_SAT, STOPS.VIL_259_KASBA, STOPS.SHAHJAHANPUR, STOPS.VIL_260_KASBA, STOPS.SHAHABAD, STOPS.VIL_261_KASBA, STOPS.HARDOI, STOPS.VIL_262_KASBA, STOPS.SANDILA, STOPS.VIL_263_KASBA, STOPS.LKO_CHARBAGH], 3);
const PATH_R_MRD_GZB = interpolatePath([STOPS.MORADABAD, STOPS.AMROHA, STOPS.GZB_KAUSHAMBI], 4);
const PATH_R_LKO_LKH = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.SITAPUR, STOPS.BISWAN, STOPS.LAKHIMPUR], 3);
const PATH_R_LKO_HDI = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.SANDILA, STOPS.HARDOI], 4);
const PATH_R_LKO_PRY = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.UNNAO, STOPS.RAEBARELI, STOPS.SALON, STOPS.FATEHPUR, STOPS.CIVIL_LINEPRY], 3);
const PATH_R_LKO_AYO = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.BARABANKI, STOPS.AYODHYA_DHAM], 4);
const PATH_R_AYO_GKP = interpolatePath([STOPS.AYODHYA_DHAM, STOPS.GONDA, STOPS.BASTI, STOPS.GORAKHPUR], 3);
const PATH_R_LKO_BHR = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.BARABANKI, STOPS.GONDA, STOPS.BALRAMPUR, STOPS.BAHRAICH], 3);
const PATH_R_KAN_KNJ = interpolatePath([STOPS.KAN_CENTRAL, STOPS.KANPUR_NT, STOPS.KANNAUJ, STOPS.FARRUKHABAD], 3);
const PATH_R_KAN_AGR = interpolatePath([STOPS.KAN_CENTRAL, STOPS.AURAIYA, STOPS.ETAWAH, STOPS.MAINPURI, STOPS.ISBT_AGRA], 3);
const PATH_R_KAN_JHS = interpolatePath([STOPS.KAN_CENTRAL, STOPS.KANPUR_DEHAT, STOPS.ORAI, STOPS.HAMIRPUR, STOPS.JHANSI], 3);
const PATH_R_PRY_VNS = interpolatePath([STOPS.CIVIL_LINEPRY, STOPS.KAUSHAMBI, STOPS.BHADOHI, STOPS.VARANASI], 3);
const PATH_R_PRY_SNB = interpolatePath([STOPS.CIVIL_LINEPRY, STOPS.MIRZAPUR, STOPS.ROBERTSGANJ], 4);
const PATH_R_PRY_LKO = interpolatePath([STOPS.CIVIL_LINEPRY, STOPS.PRATAPGARH, STOPS.SULTANPUR, STOPS.AMETHI, STOPS.LKO_CHARBAGH], 3);
const PATH_R_VNS_AZM = interpolatePath([STOPS.VARANASI, STOPS.KERAKAT, STOPS.JAUNPUR, STOPS.AZAMGARH], 3);
const PATH_R_VNS_BLA = interpolatePath([STOPS.VARANASI, STOPS.GHAZIPUR, STOPS.BALLIA], 4);
const PATH_R_VNS_MZP = interpolatePath([STOPS.VARANASI, STOPS.CHANDAULI, STOPS.MIRZAPUR], 4);
const PATH_R_GKP_AYO = interpolatePath([STOPS.GORAKHPUR, STOPS.BASTI, STOPS.SANT_KABIR, STOPS.AYODHYA_DHAM], 3);
const PATH_R_GKP_MHJ = interpolatePath([STOPS.GORAKHPUR, STOPS.KUSHINAGAR, STOPS.MAHARAJGANJ], 4);
const PATH_R_GKP_DRV = interpolatePath([STOPS.GORAKHPUR, STOPS.DEORIA], 4);
const PATH_R_DRV_BLA = interpolatePath([STOPS.DEORIA, STOPS.MAU, STOPS.BALLIA], 4);
const PATH_R_AZM_AYO = interpolatePath([STOPS.AZAMGARH, STOPS.JAUNPUR, STOPS.SULTANPUR, STOPS.AYODHYA_DHAM], 3);
const PATH_R_GND_SHR = interpolatePath([STOPS.GONDA, STOPS.BALRAMPUR, STOPS.SHRAVASTI], 4);
const PATH_R_BHR_LKO = interpolatePath([STOPS.BAHRAICH, STOPS.GONDA, STOPS.BARABANKI, STOPS.LKO_CHARBAGH], 3);
const PATH_R_SDN_GKP = interpolatePath([STOPS.SIDDHARTHNAGAR, STOPS.BASTI, STOPS.GORAKHPUR], 4);
const PATH_R_JHS_LTP = interpolatePath([STOPS.JHANSI, STOPS.LALITPUR], 4);
const PATH_R_JHS_PRY = interpolatePath([STOPS.JHANSI, STOPS.HAMIRPUR, STOPS.RATH, STOPS.BANDA, STOPS.CHITRAKOOT, STOPS.CIVIL_LINEPRY], 3);
const PATH_R_JHS_BND = interpolatePath([STOPS.JHANSI, STOPS.MAHOBA, STOPS.BANDA], 4);
const PATH_R_BND_PRY = interpolatePath([STOPS.BANDA, STOPS.CHITRAKOOT, STOPS.KAUSHAMBI, STOPS.CIVIL_LINEPRY], 3);
const PATH_R_SRE_PHA_AMB_GAN = interpolatePath([STOPS.SRE_DEPOT, STOPS.PHANDPURI, STOPS.KHERA_AFGAN, STOPS.AMBEHTA_PEER, STOPS.GANGOH], 3);
const PATH_R_SRE_MZN_R = interpolatePath([STOPS.MUZAFFARNAGAR, STOPS.VIL_224_KASBA, STOPS.SHAMLI, STOPS.VIL_223_KASBA, STOPS.SRE_DEPOT], 3);
const PATH_R_MZN_MRT_R = interpolatePath([STOPS.MRT_BHAISALI, STOPS.VIL_226_KASBA, STOPS.KHATAULI, STOPS.VIL_225_KASBA, STOPS.MUZAFFARNAGAR], 3);
const PATH_R_MRT_DEL_R = interpolatePath([STOPS.DEL_ANAND_VIHAR, STOPS.GZB_KAUSHAMBI, STOPS.VIL_229_KASBA, STOPS.GZB_OLD, STOPS.VIL_228_KASBA, STOPS.MODINAGAR, STOPS.VIL_227_KASBA, STOPS.MRT_BHAISALI], 3);
const PATH_R_MRT_HPR_R = interpolatePath([STOPS.HAPUR, STOPS.VIL_230_KASBA, STOPS.MRT_BHAISALI], 4);
const PATH_R_HPR_ALG_R = interpolatePath([STOPS.ALIGARH, STOPS.VIL_233_KASBA, STOPS.BULANDSHAHR, STOPS.VIL_232_KASBA, STOPS.SIYANA, STOPS.VIL_231_KASBA, STOPS.HAPUR], 3);
const PATH_R_GZB_BLS_R = interpolatePath([STOPS.BULANDSHAHR, STOPS.VIL_235_KASBA, STOPS.GARHMUKTESHWAR, STOPS.VIL_234_KASBA, STOPS.GZB_KAUSHAMBI], 3);
const PATH_R_ALG_AGR_R = interpolatePath([STOPS.ISBT_AGRA, STOPS.VIL_238_KASBA, STOPS.MATHURA, STOPS.VIL_237_KASBA, STOPS.HATHRAS, STOPS.VIL_236_KASBA, STOPS.ALIGARH], 3);
const PATH_R_AGR_FZB_R = interpolatePath([STOPS.FIROZABAD, STOPS.VIL_240_KASBA, STOPS.TUNDLA, STOPS.VIL_239_KASBA, STOPS.ISBT_AGRA], 3);
const PATH_R_FZB_MPR_R = interpolatePath([STOPS.MAINPURI, STOPS.VIL_241_KASBA, STOPS.FIROZABAD], 4);
const PATH_R_MPR_ETW_R = interpolatePath([STOPS.ETAWAH, STOPS.VIL_242_KASBA, STOPS.MAINPURI], 4);
const PATH_R_ETW_KAN_R = interpolatePath([STOPS.KAN_CENTRAL, STOPS.VIL_244_KASBA, STOPS.JHINJHAK, STOPS.VIL_243_KASBA, STOPS.ETAWAH], 3);
const PATH_R_ALG_KSG_R = interpolatePath([STOPS.KASGANJ, STOPS.VIL_246_KASBA, STOPS.ETAH, STOPS.VIL_245_KASBA, STOPS.ALIGARH], 3);
const PATH_R_SRE_BJN_R = interpolatePath([STOPS.MORADABAD, STOPS.VIL_250_KASBA, STOPS.CHANDPUR, STOPS.VIL_249_KASBA, STOPS.BIJNOR, STOPS.VIL_248_KASBA, STOPS.NAJIBABAD, STOPS.VIL_247_KASBA, STOPS.SRE_DEPOT], 3);
const PATH_R_MRD_BLY_R = interpolatePath([STOPS.BAREILLY_SAT, STOPS.VIL_253_KASBA, STOPS.RAMPUR, STOPS.VIL_252_KASBA, STOPS.BILASPUR, STOPS.VIL_251_KASBA, STOPS.MORADABAD], 3);
const PATH_R_BLY_PLB_R = interpolatePath([STOPS.PILIBHIT, STOPS.VIL_255_KASBA, STOPS.BISALPUR, STOPS.VIL_254_KASBA, STOPS.BAREILLY_SAT], 3);
const PATH_R_PLB_LKH_R = interpolatePath([STOPS.SITAPUR, STOPS.VIL_257_KASBA, STOPS.LAKHIMPUR, STOPS.VIL_256_KASBA, STOPS.PILIBHIT], 3);
const PATH_R_BLY_BDN_R = interpolatePath([STOPS.BUDAUN, STOPS.VIL_258_KASBA, STOPS.BAREILLY_SAT], 4);
const PATH_R_BLY_LKO_R = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.VIL_263_KASBA, STOPS.SANDILA, STOPS.VIL_262_KASBA, STOPS.HARDOI, STOPS.VIL_261_KASBA, STOPS.SHAHABAD, STOPS.VIL_260_KASBA, STOPS.SHAHJAHANPUR, STOPS.VIL_259_KASBA, STOPS.BAREILLY_SAT], 3);
const PATH_R_MRD_GZB_R = interpolatePath([STOPS.GZB_KAUSHAMBI, STOPS.AMROHA, STOPS.MORADABAD], 4);
const PATH_R_LKO_LKH_R = interpolatePath([STOPS.LAKHIMPUR, STOPS.BISWAN, STOPS.SITAPUR, STOPS.LKO_CHARBAGH], 3);
const PATH_R_LKO_HDI_R = interpolatePath([STOPS.HARDOI, STOPS.SANDILA, STOPS.LKO_CHARBAGH], 4);
const PATH_R_LKO_PRY_R = interpolatePath([STOPS.CIVIL_LINEPRY, STOPS.FATEHPUR, STOPS.SALON, STOPS.RAEBARELI, STOPS.UNNAO, STOPS.LKO_CHARBAGH], 3);
const PATH_R_LKO_AYO_R = interpolatePath([STOPS.AYODHYA_DHAM, STOPS.BARABANKI, STOPS.LKO_CHARBAGH], 4);
const PATH_R_AYO_GKP_R = interpolatePath([STOPS.GORAKHPUR, STOPS.BASTI, STOPS.GONDA, STOPS.AYODHYA_DHAM], 3);
const PATH_R_LKO_BHR_R = interpolatePath([STOPS.BAHRAICH, STOPS.BALRAMPUR, STOPS.GONDA, STOPS.BARABANKI, STOPS.LKO_CHARBAGH], 3);
const PATH_R_KAN_KNJ_R = interpolatePath([STOPS.FARRUKHABAD, STOPS.KANNAUJ, STOPS.KANPUR_NT, STOPS.KAN_CENTRAL], 3);
const PATH_R_KAN_AGR_R = interpolatePath([STOPS.ISBT_AGRA, STOPS.MAINPURI, STOPS.ETAWAH, STOPS.AURAIYA, STOPS.KAN_CENTRAL], 3);
const PATH_R_KAN_JHS_R = interpolatePath([STOPS.JHANSI, STOPS.HAMIRPUR, STOPS.ORAI, STOPS.KANPUR_DEHAT, STOPS.KAN_CENTRAL], 3);
const PATH_R_PRY_VNS_R = interpolatePath([STOPS.VARANASI, STOPS.BHADOHI, STOPS.KAUSHAMBI, STOPS.CIVIL_LINEPRY], 3);
const PATH_R_PRY_SNB_R = interpolatePath([STOPS.ROBERTSGANJ, STOPS.MIRZAPUR, STOPS.CIVIL_LINEPRY], 4);
const PATH_R_PRY_LKO_R = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.AMETHI, STOPS.SULTANPUR, STOPS.PRATAPGARH, STOPS.CIVIL_LINEPRY], 3);
const PATH_R_VNS_AZM_R = interpolatePath([STOPS.AZAMGARH, STOPS.JAUNPUR, STOPS.KERAKAT, STOPS.VARANASI], 3);
const PATH_R_VNS_BLA_R = interpolatePath([STOPS.BALLIA, STOPS.GHAZIPUR, STOPS.VARANASI], 4);
const PATH_R_VNS_MZP_R = interpolatePath([STOPS.MIRZAPUR, STOPS.CHANDAULI, STOPS.VARANASI], 4);
const PATH_R_GKP_AYO_R = interpolatePath([STOPS.AYODHYA_DHAM, STOPS.SANT_KABIR, STOPS.BASTI, STOPS.GORAKHPUR], 3);
const PATH_R_GKP_MHJ_R = interpolatePath([STOPS.MAHARAJGANJ, STOPS.KUSHINAGAR, STOPS.GORAKHPUR], 4);
const PATH_R_GKP_DRV_R = interpolatePath([STOPS.DEORIA, STOPS.GORAKHPUR], 4);
const PATH_R_DRV_BLA_R = interpolatePath([STOPS.BALLIA, STOPS.MAU, STOPS.DEORIA], 4);
const PATH_R_AZM_AYO_R = interpolatePath([STOPS.AYODHYA_DHAM, STOPS.SULTANPUR, STOPS.JAUNPUR, STOPS.AZAMGARH], 3);
const PATH_R_GND_SHR_R = interpolatePath([STOPS.SHRAVASTI, STOPS.BALRAMPUR, STOPS.GONDA], 4);
const PATH_R_BHR_LKO_R = interpolatePath([STOPS.LKO_CHARBAGH, STOPS.BARABANKI, STOPS.GONDA, STOPS.BAHRAICH], 3);
const PATH_R_SDN_GKP_R = interpolatePath([STOPS.GORAKHPUR, STOPS.BASTI, STOPS.SIDDHARTHNAGAR], 4);
const PATH_R_JHS_LTP_R = interpolatePath([STOPS.LALITPUR, STOPS.JHANSI], 4);
const PATH_R_JHS_PRY_R = interpolatePath([STOPS.CIVIL_LINEPRY, STOPS.CHITRAKOOT, STOPS.BANDA, STOPS.RATH, STOPS.HAMIRPUR, STOPS.JHANSI], 3);
const PATH_R_JHS_BND_R = interpolatePath([STOPS.BANDA, STOPS.MAHOBA, STOPS.JHANSI], 4);
const PATH_R_BND_PRY_R = interpolatePath([STOPS.CIVIL_LINEPRY, STOPS.KAUSHAMBI, STOPS.CHITRAKOOT, STOPS.BANDA], 3);
const PATH_R_SRE_PHA_AMB_GAN_R = interpolatePath([STOPS.GANGOH, STOPS.AMBEHTA_PEER, STOPS.KHERA_AFGAN, STOPS.PHANDPURI, STOPS.SRE_DEPOT], 3);
const PATH_R_LKO_KAN_R = interpolatePath([STOPS.KAN_CENTRAL, STOPS.VIL_201_KASBA, STOPS.UNNAO, STOPS.VIL_200_KASBA, STOPS.LKO_ALAMBAGH, STOPS.LKO_CHARBAGH], 3);
const PATH_R_DEL_MRT_R = interpolatePath([STOPS.MRT_BHAISALI, STOPS.VIL_204_KASBA, STOPS.MODINAGAR, STOPS.VIL_203_KASBA, STOPS.GZB_OLD, STOPS.VIL_202_KASBA, STOPS.GZB_KAUSHAMBI, STOPS.DEL_ANAND_VIHAR], 3);
const PATH_R_LKO_VNS_R = interpolatePath([STOPS.VARANASI, STOPS.VIL_206_KASBA, STOPS.AYODHYA_DHAM, STOPS.VIL_205_KASBA, STOPS.LKO_ALAMBAGH, STOPS.LKO_CHARBAGH], 3);
const PATH_R_DEL_AGR_R = interpolatePath([STOPS.ISBT_AGRA, STOPS.VIL_207_KASBA, STOPS.NOIDA_35, STOPS.GZB_KAUSHAMBI, STOPS.DEL_ANAND_VIHAR], 3);
const PATH_R_VNS_PRY_R = interpolatePath([STOPS.CIVIL_LINEPRY, STOPS.VIL_208_KASBA, STOPS.VARANASI], 4);
const PATH_R_JHN_MTH_R = interpolatePath([STOPS.MATHURA, STOPS.VIL_210_KASBA, STOPS.ISBT_AGRA, STOPS.VIL_209_KASBA, STOPS.JHANSI], 3);
const PATH_R_GAN_AMB_PHA_SRE_R = interpolatePath([STOPS.GANGOH, STOPS.AMBEHTA_PEER, STOPS.KHERA_AFGAN, STOPS.PHANDPURI, STOPS.SRE_DEPOT], 3);

interface SimulatedBusState { registrationNo: string; path: { lat: number; lng: number }[]; currentIndex: number; direction: 1 | -1; routeCode: string; lastTimestampMs: number; }

// Staggered start timestamps: each bus begins at a unique time offset so
// packets are never out-of-order from the first ping.
const BASE_SIM_TIME = Date.now() - 300_000; // 5 min ago

function makeBus(regNo: string, path: { lat: number; lng: number }[], routeCode: string, offsetMs = 0): SimulatedBusState {
  return { registrationNo: regNo, path, currentIndex: 0, direction: 1, routeCode, lastTimestampMs: BASE_SIM_TIME + offsetMs };
}

const simulatedBuses: SimulatedBusState[] = [
  makeBus('UP 32 AN 9876', PATH_R_LKO_KAN, 'R_LKO_KAN', 0),
  makeBus('UP 14 DT 5566', PATH_R_DEL_MRT, 'R_DEL_MRT', 600),
  makeBus('UP 32 BG 4321', PATH_R_LKO_VNS, 'R_LKO_VNS', 1200),
  makeBus('UP 15 AT 1122', PATH_R_DEL_AGR, 'R_DEL_AGR', 1800),
  makeBus('UP 70 AN 5566', PATH_R_VNS_PRY, 'R_VNS_PRY', 2400),
  makeBus('UP 53 DT 2233', PATH_R_JHN_MTH, 'R_JHN_MTH', 3000),
  makeBus('UP 11 AT 1234', PATH_R_SRE_BEH_SHK, 'R_SRE_BEH_SHK', 3600),
  makeBus('UP 11 BT 5678', PATH_R_SRE_RAM_NAN_DEO, 'R_SRE_RAM_NAN_DEO', 4200),
  makeBus('UP 11 CT 9012', PATH_R_SRE_PHA_NAK_GAN, 'R_SRE_PHA_NAK_GAN', 4800),
  makeBus('UP 11 DT 3456', PATH_R_SHK_BEH_SRE, 'R_SHK_BEH_SRE', 5400),
  makeBus('UP 11 ET 7890', PATH_R_DEO_NAN_RAM_SRE, 'R_DEO_NAN_RAM_SRE', 6000),
  makeBus('UP 11 FT 4321', PATH_R_GAN_NAK_PHA_SRE, 'R_GAN_NAK_PHA_SRE', 6600),
  makeBus('UP 30 AM 1481', PATH_R_SRE_MZN, 'R_SRE_MZN', 7200),
  makeBus('UP 31 AN 1518', PATH_R_MZN_MRT, 'R_MZN_MRT', 7800),
  makeBus('UP 33 AO 1555', PATH_R_MRT_DEL, 'R_MRT_DEL', 8400),
  makeBus('UP 34 AP 1592', PATH_R_MRT_HPR, 'R_MRT_HPR', 9000),
  makeBus('UP 35 AQ 1629', PATH_R_HPR_ALG, 'R_HPR_ALG', 9600),
  makeBus('UP 36 AR 1666', PATH_R_GZB_BLS, 'R_GZB_BLS', 10200),
  makeBus('UP 37 AS 1703', PATH_R_ALG_AGR, 'R_ALG_AGR', 10800),
  makeBus('UP 38 AT 1740', PATH_R_AGR_FZB, 'R_AGR_FZB', 11400),
  makeBus('UP 39 AU 1777', PATH_R_FZB_MPR, 'R_FZB_MPR', 12000),
  makeBus('UP 40 AV 1814', PATH_R_MPR_ETW, 'R_MPR_ETW', 12600),
  makeBus('UP 41 AW 1851', PATH_R_ETW_KAN, 'R_ETW_KAN', 13200),
  makeBus('UP 42 AX 1888', PATH_R_ALG_KSG, 'R_ALG_KSG', 13800),
  makeBus('UP 43 AY 1925', PATH_R_SRE_BJN, 'R_SRE_BJN', 14400),
  makeBus('UP 44 AZ 1962', PATH_R_MRD_BLY, 'R_MRD_BLY', 15000),
  makeBus('UP 45 AA 1999', PATH_R_BLY_PLB, 'R_BLY_PLB', 15600),
  makeBus('UP 47 AB 2036', PATH_R_PLB_LKH, 'R_PLB_LKH', 16200),
  makeBus('UP 48 AC 2073', PATH_R_BLY_BDN, 'R_BLY_BDN', 16800),
  makeBus('UP 49 AD 2110', PATH_R_BLY_LKO, 'R_BLY_LKO', 17400),
  makeBus('UP 50 AE 2147', PATH_R_MRD_GZB, 'R_MRD_GZB', 18000),
  makeBus('UP 51 AF 2184', PATH_R_LKO_LKH, 'R_LKO_LKH', 18600),
  makeBus('UP 52 AG 2221', PATH_R_LKO_HDI, 'R_LKO_HDI', 19200),
  makeBus('UP 53 AH 2258', PATH_R_LKO_PRY, 'R_LKO_PRY', 19800),
  makeBus('UP 54 AI 2295', PATH_R_LKO_AYO, 'R_LKO_AYO', 20400),
  makeBus('UP 55 AJ 2332', PATH_R_AYO_GKP, 'R_AYO_GKP', 21000),
  makeBus('UP 56 AK 2369', PATH_R_LKO_BHR, 'R_LKO_BHR', 21600),
  makeBus('UP 57 AL 2406', PATH_R_KAN_KNJ, 'R_KAN_KNJ', 22200),
  makeBus('UP 58 AM 2443', PATH_R_KAN_AGR, 'R_KAN_AGR', 22800),
  makeBus('UP 59 AN 2480', PATH_R_KAN_JHS, 'R_KAN_JHS', 23400),
  makeBus('UP 60 AO 2517', PATH_R_PRY_VNS, 'R_PRY_VNS', 24000),
  makeBus('UP 61 AP 2554', PATH_R_PRY_SNB, 'R_PRY_SNB', 24600),
  makeBus('UP 62 AQ 2591', PATH_R_PRY_LKO, 'R_PRY_LKO', 25200),
  makeBus('UP 63 AR 2628', PATH_R_VNS_AZM, 'R_VNS_AZM', 25800),
  makeBus('UP 64 AS 2665', PATH_R_VNS_BLA, 'R_VNS_BLA', 26400),
  makeBus('UP 65 AT 2702', PATH_R_VNS_MZP, 'R_VNS_MZP', 27000),
  makeBus('UP 66 AU 2739', PATH_R_GKP_AYO, 'R_GKP_AYO', 27600),
  makeBus('UP 67 AV 2776', PATH_R_GKP_MHJ, 'R_GKP_MHJ', 28200),
  makeBus('UP 68 AW 2813', PATH_R_GKP_DRV, 'R_GKP_DRV', 28800),
  makeBus('UP 69 AX 2850', PATH_R_DRV_BLA, 'R_DRV_BLA', 29400),
  makeBus('UP 70 AY 2887', PATH_R_AZM_AYO, 'R_AZM_AYO', 30000),
  makeBus('UP 71 AZ 2924', PATH_R_GND_SHR, 'R_GND_SHR', 30600),
  makeBus('UP 72 AA 2961', PATH_R_BHR_LKO, 'R_BHR_LKO', 31200),
  makeBus('UP 73 AB 2998', PATH_R_SDN_GKP, 'R_SDN_GKP', 31800),
  makeBus('UP 74 AC 3035', PATH_R_JHS_LTP, 'R_JHS_LTP', 32400),
  makeBus('UP 75 AD 3072', PATH_R_JHS_PRY, 'R_JHS_PRY', 33000),
  makeBus('UP 76 AE 3109', PATH_R_JHS_BND, 'R_JHS_BND', 33600),
  makeBus('UP 77 AF 3146', PATH_R_BND_PRY, 'R_BND_PRY', 34200),
  makeBus('UP 78 AG 3183', PATH_R_SRE_PHA_AMB_GAN, 'R_SRE_PHA_AMB_GAN', 34800),
  makeBus('UP 79 AH 3220', PATH_R_SRE_MZN_R, 'R_SRE_MZN_R', 35400),
  makeBus('UP 80 AI 3257', PATH_R_MZN_MRT_R, 'R_MZN_MRT_R', 36000),
  makeBus('UP 81 AJ 3294', PATH_R_MRT_DEL_R, 'R_MRT_DEL_R', 36600),
  makeBus('UP 82 AK 3331', PATH_R_MRT_HPR_R, 'R_MRT_HPR_R', 37200),
  makeBus('UP 83 AL 3368', PATH_R_HPR_ALG_R, 'R_HPR_ALG_R', 37800),
  makeBus('UP 84 AM 3405', PATH_R_GZB_BLS_R, 'R_GZB_BLS_R', 38400),
  makeBus('UP 85 AN 3442', PATH_R_ALG_AGR_R, 'R_ALG_AGR_R', 39000),
  makeBus('UP 86 AO 3479', PATH_R_AGR_FZB_R, 'R_AGR_FZB_R', 39600),
  makeBus('UP 87 AP 3516', PATH_R_FZB_MPR_R, 'R_FZB_MPR_R', 40200),
  makeBus('UP 88 AQ 3553', PATH_R_MPR_ETW_R, 'R_MPR_ETW_R', 40800),
  makeBus('UP 89 AR 3590', PATH_R_ETW_KAN_R, 'R_ETW_KAN_R', 41400),
  makeBus('UP 90 AS 3627', PATH_R_ALG_KSG_R, 'R_ALG_KSG_R', 42000),
  makeBus('UP 91 AT 3664', PATH_R_SRE_BJN_R, 'R_SRE_BJN_R', 42600),
  makeBus('UP 92 AU 3701', PATH_R_MRD_BLY_R, 'R_MRD_BLY_R', 43200),
  makeBus('UP 93 AV 3738', PATH_R_BLY_PLB_R, 'R_BLY_PLB_R', 43800),
  makeBus('UP 94 AW 3775', PATH_R_PLB_LKH_R, 'R_PLB_LKH_R', 44400),
  makeBus('UP 95 AX 3812', PATH_R_BLY_BDN_R, 'R_BLY_BDN_R', 45000),
  makeBus('UP 11 AY 3849', PATH_R_BLY_LKO_R, 'R_BLY_LKO_R', 45600),
  makeBus('UP 14 AZ 3886', PATH_R_MRD_GZB_R, 'R_MRD_GZB_R', 46200),
  makeBus('UP 15 AA 3923', PATH_R_LKO_LKH_R, 'R_LKO_LKH_R', 46800),
  makeBus('UP 32 AB 3960', PATH_R_LKO_HDI_R, 'R_LKO_HDI_R', 47400),
  makeBus('UP 53 AC 3997', PATH_R_LKO_PRY_R, 'R_LKO_PRY_R', 48000),
  makeBus('UP 70 AD 4034', PATH_R_LKO_AYO_R, 'R_LKO_AYO_R', 48600),
  makeBus('UP 20 AE 4071', PATH_R_AYO_GKP_R, 'R_AYO_GKP_R', 49200),
  makeBus('UP 22 AF 4108', PATH_R_LKO_BHR_R, 'R_LKO_BHR_R', 49800),
  makeBus('UP 25 AG 4145', PATH_R_KAN_KNJ_R, 'R_KAN_KNJ_R', 50400),
  makeBus('UP 26 AH 4182', PATH_R_KAN_AGR_R, 'R_KAN_AGR_R', 51000),
  makeBus('UP 27 AI 4219', PATH_R_KAN_JHS_R, 'R_KAN_JHS_R', 51600),
  makeBus('UP 28 AJ 4256', PATH_R_PRY_VNS_R, 'R_PRY_VNS_R', 52200),
  makeBus('UP 30 AK 4293', PATH_R_PRY_SNB_R, 'R_PRY_SNB_R', 52800),
  makeBus('UP 31 AL 4330', PATH_R_PRY_LKO_R, 'R_PRY_LKO_R', 53400),
  makeBus('UP 33 AM 4367', PATH_R_VNS_AZM_R, 'R_VNS_AZM_R', 54000),
  makeBus('UP 34 AN 4404', PATH_R_VNS_BLA_R, 'R_VNS_BLA_R', 54600),
  makeBus('UP 35 AO 4441', PATH_R_VNS_MZP_R, 'R_VNS_MZP_R', 55200),
  makeBus('UP 36 AP 4478', PATH_R_GKP_AYO_R, 'R_GKP_AYO_R', 55800),
  makeBus('UP 37 AQ 4515', PATH_R_GKP_MHJ_R, 'R_GKP_MHJ_R', 56400),
  makeBus('UP 38 AR 4552', PATH_R_GKP_DRV_R, 'R_GKP_DRV_R', 57000),
  makeBus('UP 39 AS 4589', PATH_R_DRV_BLA_R, 'R_DRV_BLA_R', 57600),
  makeBus('UP 40 AT 4626', PATH_R_AZM_AYO_R, 'R_AZM_AYO_R', 58200),
  makeBus('UP 41 AU 4663', PATH_R_GND_SHR_R, 'R_GND_SHR_R', 58800),
  makeBus('UP 42 AV 4700', PATH_R_BHR_LKO_R, 'R_BHR_LKO_R', 59400),
  makeBus('UP 43 BW 4737', PATH_R_SDN_GKP_R, 'R_SDN_GKP_R', 60000),
  makeBus('UP 44 BX 4774', PATH_R_JHS_LTP_R, 'R_JHS_LTP_R', 60600),
  makeBus('UP 45 BY 4811', PATH_R_JHS_PRY_R, 'R_JHS_PRY_R', 61200),
  makeBus('UP 47 BZ 4848', PATH_R_JHS_BND_R, 'R_JHS_BND_R', 61800),
  makeBus('UP 48 BA 4885', PATH_R_BND_PRY_R, 'R_BND_PRY_R', 62400),
  makeBus('UP 49 BB 4922', PATH_R_SRE_PHA_AMB_GAN_R, 'R_SRE_PHA_AMB_GAN_R', 63000),
  makeBus('UP 50 BC 4959', PATH_R_LKO_KAN_R, 'R_LKO_KAN_R', 63600),
  makeBus('UP 51 BD 4996', PATH_R_DEL_MRT_R, 'R_DEL_MRT_R', 64200),
  makeBus('UP 52 BE 5033', PATH_R_LKO_VNS_R, 'R_LKO_VNS_R', 64800),
  makeBus('UP 53 BF 5070', PATH_R_DEL_AGR_R, 'R_DEL_AGR_R', 65400),
  makeBus('UP 54 BG 5107', PATH_R_VNS_PRY_R, 'R_VNS_PRY_R', 66000),
  makeBus('UP 55 BH 5144', PATH_R_JHN_MTH_R, 'R_JHN_MTH_R', 66600),
  makeBus('UP 56 BI 5181', PATH_R_GAN_AMB_PHA_SRE_R, 'R_GAN_AMB_PHA_SRE_R', 67200),
];


let ingestionTimer: NodeJS.Timeout | null = null;

// Helpers to calculate bearing
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

// Ingest location update into PostgreSQL
export async function ingestLocation(location: CanonicalVehicleLocation) {
  try {
    // 1. Find or create the bus
    let busRes = await query('SELECT id FROM buses WHERE registration_no = $1', [location.registrationNo]);
    let busId: number;

    if (busRes.rows.length === 0) {
      const insertBus = await query(
        'INSERT INTO buses (registration_no, bus_type, depot_name) VALUES ($1, $2, $3) RETURNING id',
        [location.registrationNo, 'Ordinary', 'Unknown Depot']
      );
      busId = insertBus.rows[0].id;
    } else {
      busId = busRes.rows[0].id;
    }

    // 2. Find or create an active trip for this bus
    let tripRes = await query(
      "SELECT id FROM trips WHERE bus_id = $1 AND status = 'running' ORDER BY created_at DESC LIMIT 1",
      [busId]
    );
    let tripId: number;

    if (tripRes.rows.length === 0) {
      // Find a route that is likely for this bus or default to first
      const routeRes = await query('SELECT id FROM routes ORDER BY id LIMIT 1');
      const routeId = routeRes.rows[0]?.id || 1;

      const insertTrip = await query(
        "INSERT INTO trips (bus_id, route_id, scheduled_start, status) VALUES ($1, $2, NOW(), 'running') RETURNING id",
        [busId, routeId]
      );
      tripId = insertTrip.rows[0].id;
    } else {
      tripId = tripRes.rows[0].id;
    }

    // 3. Upsert into bus_live_state
    await query(
      `INSERT INTO bus_live_state (bus_id, trip_id, latitude, longitude, speed, heading, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (bus_id) 
       DO UPDATE SET 
          trip_id = EXCLUDED.trip_id,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          speed = EXCLUDED.speed,
          heading = EXCLUDED.heading,
          last_seen_at = EXCLUDED.last_seen_at`,
      [
        busId,
        tripId,
        location.latitude,
        location.longitude,
        location.speed,
        location.heading,
        location.timestamp
      ]
    );

    console.log(`Ingested: Bus ${location.registrationNo} is at (${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}) going ${location.speed} km/h`);
  } catch (error) {
    console.error('Error ingesting bus location:', error);
  }
}

// Simulator loop function
async function runSimulationStep() {
  const activeCrowdSourced = (global as any).activeCrowdSourcedTrips || {};
  const now = Date.now();

  for (const bus of simulatedBuses) {
    let isCrowdSourced = false;
    try {
      const busRes = await query('SELECT id FROM buses WHERE registration_no = $1', [bus.registrationNo]);
      if (busRes.rows.length > 0) {
        const busId = busRes.rows[0].id;
        const routeRes = await query('SELECT id FROM routes WHERE route_code = $1', [bus.routeCode]);
        const routeId = routeRes.rows[0]?.id;
        if (routeId) {
          const tripRes = await query(
            "SELECT id FROM trips WHERE bus_id = $1 AND route_id = $2 AND status = 'running' LIMIT 1",
            [busId, routeId]
          );
          if (tripRes.rows.length > 0) {
            const tripId = tripRes.rows[0].id;
            const state = activeCrowdSourced[tripId];
            if (state && now - state.timestamp < 15000) {
              isCrowdSourced = true;
            }
          }
        }
      }
    } catch (e) {
      // Ignore
    }

    if (isCrowdSourced) {
      continue;
    }

    const prevPoint = bus.path[bus.currentIndex];

    // Move to next point
    bus.currentIndex += bus.direction;

    // Boundary check: Reverse direction when reaching start/end stops
    if (bus.currentIndex >= bus.path.length) {
      bus.currentIndex = bus.path.length - 2;
      bus.direction = -1;
    } else if (bus.currentIndex < 0) {
      bus.currentIndex = 1;
      bus.direction = 1;
    }

    const currentPoint = bus.path[bus.currentIndex];

    // Calculate heading/bearing
    const heading = calculateBearing(prevPoint.lat, prevPoint.lng, currentPoint.lat, currentPoint.lng);

    // Calculate simulated speed (slower near stops, faster in-between)
    const isStop = bus.currentIndex === 0 || bus.currentIndex === bus.path.length - 1;
    const speed = isStop ? 0 : Math.floor(45 + Math.random() * 20); // 0 km/h at terminal, otherwise 45-65 km/h

    // Advance this bus's own monotonic timestamp by 6 seconds (interval duration)
    // This guarantees every packet is strictly newer than the last for this bus,
    // eliminating all "Out-of-order timestamp" and "Duplicate packet" rejections.
    bus.lastTimestampMs += 6000;
    const packetTimestamp = new Date(bus.lastTimestampMs);

    const location: CanonicalVehicleLocation = {
      registrationNo: bus.registrationNo,
      latitude: currentPoint.lat,
      longitude: currentPoint.lng,
      speed,
      heading,
      timestamp: packetTimestamp,
      status: speed === 0 ? 'halted' : 'moving'
    };

    // Ensure we bind the trip correctly to the specific route
    try {
      const busRes = await query('SELECT id FROM buses WHERE registration_no = $1', [bus.registrationNo]);
      if (busRes.rows.length > 0) {
        const busId = busRes.rows[0].id;
        const routeRes = await query('SELECT id FROM routes WHERE route_code = $1', [bus.routeCode]);
        const routeId = routeRes.rows[0]?.id;

        if (routeId) {
          // Check if there is an active trip on this SPECIFIC route
          const tripRes = await query(
            "SELECT id FROM trips WHERE bus_id = $1 AND route_id = $2 AND status = 'running' LIMIT 1",
            [busId, routeId]
          );

          if (tripRes.rows.length === 0) {
            // Create a new running trip for this specific route
            await query(
              "INSERT INTO trips (bus_id, route_id, scheduled_start, status) VALUES ($1, $2, NOW(), 'running')",
              [busId, routeId]
            );
          }
        }
      }
    } catch (e) {
      console.error('Error preparing simulated trip registry:', e);
    }

    // Run ingestion
    await ingestLocation(location);
  }
}

// Public Ingestion Manager API
export function startIngestion() {
  const isSimulator = process.env.SIMULATOR_MODE !== 'false';

  if (isSimulator) {
    console.log('--- Starting GPS Ingestion In Simulator Mode ---');
    // Run simulation step every 6 seconds
    runSimulationStep(); // Run once immediately
    ingestionTimer = setInterval(runSimulationStep, 6000);
  } else {
    console.log('--- Starting GPS Ingestion In Live Mode (Margdarshi API Adapter) ---');
    const fetchLiveLocations = async () => {
      try {
        console.log('Attempting to fetch live locations from Margdarshi API...');
      } catch (err) {
        console.error('Failed to fetch from live Margdarshi endpoint. Falling back to simulator.', err);
      }
    };
    ingestionTimer = setInterval(fetchLiveLocations, 30000); // Fetch every 30s
  }
}

export function stopIngestion() {
  if (ingestionTimer) {
    clearInterval(ingestionTimer);
    ingestionTimer = null;
    console.log('--- Ingestion Stopped ---');
  }
}
