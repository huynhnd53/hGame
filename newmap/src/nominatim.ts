import type { LonLat } from './geo';

export const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';

/** ISO 3166-1 alpha-2 followed by alpha-3, packed five letters per country. */
const ISO_PAIRS =
  'AFAFGALALBDZDZAASASMADANDAOAGOAIAIAAQATAAGATGARARGAMARMAWABWAUAUSATAUTAZAZEBSBHSBHBHRBDBGDBBBRBBYBLR' +
  'BEBELBZBLZBJBENBMBMUBTBTNBOBOLBABIHBWBWABVBVTBRBRAIOIOTBNBRNBGBGRBFBFABIBDIKHKHMCMCMRCACANCVCPVKYCYM' +
  'CFCAFTDTCDCLCHLCNCHNCXCXRCCCCKCOCOLKMCOMCGCOGCDCODCKCOKCRCRICICIVHRHRVCUCUBCYCYPCZCZEDKDNKDJDJIDMDMA' +
  'DODOMECECUEGEGYSVSLVGQGNQERERIEEESTETETHFKFLKFOFROFJFJIFIFINFRFRAGFGUFPFPYFTFATFGAGABGMGMBGEGEODEDEU' +
  'GHGHAGIGIBGRGRCGLGRLGDGRDGPGLPGUGUMGTGTMGNGINGWGNBGYGUYHTHTIHMHMDVAVATHNHNDHKHKGHUHUNISISLININDIDIDN' +
  'IRIRNIQIRQIEIRLILISRITITAJMJAMJPJPNJOJORKZKAZKEKENKIKIRKPPRKKRKORKWKWTKGKGZLALAOLVLVALBLBNLSLSOLRLBR' +
  'LYLBYLILIELTLTULULUXMOMACMGMDGMWMWIMYMYSMVMDVMLMLIMTMLTMHMHLMQMTQMRMRTMUMUSYTMYTMXMEXFMFSMMDMDAMCMCO' +
  'MNMNGMSMSRMAMARMZMOZMMMMRNANAMNRNRUNPNPLNLNLDNCNCLNZNZLNINICNENERNGNGANUNIUNFNFKMPMNPMKMKDNONOROMOMN' +
  'PKPAKPWPLWPSPSEPAPANPGPNGPYPRYPEPERPHPHLPNPCNPLPOLPTPRTPRPRIQAQATREREUROROURURUSRWRWASHSHNKNKNALCLCA' +
  'PMSPMVCVCTWSWSMSMSMRSTSTPSASAUSNSENSCSYCSLSLESGSGPSKSVKSISVNSBSLBSOSOMZAZAFGSSGSESESPLKLKASDSDNSRSUR' +
  'SJSJMSZSWZSESWECHCHESYSYRTWTWNTJTJKTZTZATHTHATLTLSTGTGOTKTKLTOTONTTTTOTNTUNTRTURTMTKMTCTCATVTUVUGUGA' +
  'UAUKRAEAREGBGBRUSUSAUMUMIUYURYUZUZBVUVUTVEVENVNVNMVGVGBVIVIRWFWLFEHESHYEYEMZMZMBZWZWEAXALABQBESCWCUW' +
  'GGGGYIMIMNJEJEYMEMNEBLBLMMFMAFRSSRBSXSXMSSSSDXKXKK';

const ISO3 = new Map<string, string>();
for (let i = 0; i < ISO_PAIRS.length; i += 5) ISO3.set(ISO_PAIRS.slice(i, i + 2), ISO_PAIRS.slice(i + 2, i + 5));

/** "vn" → "VNM"; Open Buildings files are named by alpha-3 code. */
export function iso3(alpha2: string): string | null {
  return ISO3.get(alpha2.toUpperCase()) ?? null;
}

export interface NominatimAddress {
  [key: string]: string | undefined;
  country_code?: string;
}

export interface Place {
  /** Short area name, e.g. "Khương Thượng, Đống Đa". */
  name: string;
  /** Lower-case alpha-2 code from Nominatim, e.g. "vn". */
  countryCode: string | null;
  /** Alpha-3 code, e.g. "VNM". */
  iso3: string | null;
}

/** Finest first: a ward or neighbourhood, then the district or town it belongs to. */
const LOCAL_KEYS = ['quarter', 'suburb', 'neighbourhood', 'village', 'hamlet', 'town'];
const DISTRICT_KEYS = ['city_district', 'district', 'county', 'municipality', 'city', 'state'];

export function placeName(addr: NominatimAddress, fallback = ''): string {
  const pick = (keys: string[], skip?: string) => keys.map((k) => addr[k]).find((v) => v && v !== skip);
  const local = pick(LOCAL_KEYS);
  const district = pick(DISTRICT_KEYS, local);
  return [local, district].filter(Boolean).join(', ') || fallback;
}

/** Reverse geocodes the middle of the drawn area. */
export async function lookupPlace(at: LonLat, f: typeof fetch = fetch, signal?: AbortSignal): Promise<Place> {
  const url = new URL(NOMINATIM);
  url.search = new URLSearchParams({
    lat: at[1].toFixed(6),
    lon: at[0].toFixed(6),
    format: 'jsonv2',
    zoom: '16',
    addressdetails: '1',
    'accept-language': 'vi',
  }).toString();
  const res = await f(url.toString(), { signal });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const json = (await res.json()) as { address?: NominatimAddress; display_name?: string; error?: string };
  if (json.error) throw new Error(`Nominatim: ${json.error}`);
  const addr = json.address ?? {};
  const cc = addr.country_code?.toLowerCase() ?? null;
  return {
    name: placeName(addr, json.display_name?.split(',').slice(0, 2).join(',').trim() ?? ''),
    countryCode: cc,
    iso3: cc ? iso3(cc) : null,
  };
}

export const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';

export interface SearchHit {
  name: string;
  /** The rest of the address, for telling places with the same name apart. */
  detail: string;
  lat: number;
  lon: number;
  /** South, north, west, east. */
  bbox?: [number, number, number, number];
}

interface NominatimHit {
  name?: string;
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
}

/** Places matching a search, for the box over the map. */
export async function searchPlaces(q: string, f: typeof fetch = fetch, signal?: AbortSignal): Promise<SearchHit[]> {
  const url = new URL(NOMINATIM_SEARCH);
  url.search = new URLSearchParams({ q, format: 'jsonv2', limit: '6', 'accept-language': 'vi' }).toString();
  const res = await f(url.toString(), { signal });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const hits = (await res.json()) as NominatimHit[];
  return hits.map((h) => {
    const parts = h.display_name.split(',').map((x) => x.trim());
    const name = h.name || parts[0];
    const b = h.boundingbox?.map(Number);
    return {
      name,
      detail: parts.filter((x) => x !== name).join(', '),
      lat: Number(h.lat),
      lon: Number(h.lon),
      bbox: b && b.every(Number.isFinite) ? [b[0], b[1], b[2], b[3]] : undefined,
    };
  });
}
